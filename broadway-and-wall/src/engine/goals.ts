/**
 * A RUN'S AMBITION, CHOSEN AT THE START. A hundred-year town has no win screen,
 * and "climb the street" is a direction, not a finish line. A goal is a line
 * the player draws for themselves — a target and a deadline — read off
 * quantities the game already keeps (the year marks, net worth, deliveries,
 * the rent roll). Nothing here draws a random number or moves a dollar.
 */
import type { GameState } from "./types";
import type { ParcelTable } from "@/data/types";
import { resolveRec, useRentableSf } from "./value";

export type GoalId = "street" | "nw100" | "builder" | "landlord" | "manager" | "nw500" | "developer";

export interface GoalDef { id: GoalId; label: string; detail: string; years: number }
export const GOALS: readonly GoalDef[] = [
  { id: "landlord", label: "Landlord", detail: "Half a million square feet let across your book", years: 15 },
  { id: "builder", label: "Builder", detail: "Deliver five buildings of your own", years: 20 },
  { id: "nw100", label: "A hundred million", detail: "$100M of net worth", years: 25 },
  { id: "street", label: "Top of the street", detail: "The largest firm on the street at a year's close", years: 30 },
  // The later rungs: what a firm that has done the first four does next.
  { id: "manager", label: "Manager", detail: "Raise a fund, invest it, and return the LPs their capital and more", years: 15 },
  { id: "developer", label: "Developer", detail: "Deliver fifteen buildings of your own", years: 30 },
  { id: "nw500", label: "Half a billion", detail: "$500M of net worth", years: 40 },
];

export interface Goal {
  id: GoalId; setM: number; deadlineM: number; doneM?: number; failedM?: number;
  /** Deliveries already on the record when the goal was set — a goal set in
   * year twenty counts what is built from then, not what was built before. */
  base?: number;
}

export function goalDef(id: GoalId): GoalDef {
  return GOALS.find((g) => g.id === id) ?? GOALS[0];
}

export function newGoal(id: GoalId, month: number, s?: GameState): Goal {
  const g: Goal = { id, setM: month, deadlineM: month + goalDef(id).years * 12 };
  if (s && (s.delivered ?? 0) > 0) g.base = s.delivered;
  return g;
}

/** Goals a player could take on now: not the current one, and not already met. */
export function goalsOpen(s: GameState, parcels?: ParcelTable | null): GoalDef[] {
  return GOALS.filter((d) => {
    if (s.goal && s.goal.id === d.id && s.goal.doneM === undefined && s.goal.failedM === undefined) return false;
    const trial = { ...s, goal: newGoal(d.id, s.month, s) } as GameState;
    return goalVerdict(trial, parcels) !== "done";
  });
}

/** Where the run stands against its goal: a 0..1 share and a line to print. */
export function goalProgress(s: GameState, parcels?: ParcelTable | null): { share: number; text: string } | null {
  const g = s.goal;
  if (!g) return null;
  switch (g.id) {
    case "street": {
      const m = (s.yearMarks ?? []).filter((x) => x.y >= 0).at(-1);
      if (!m) return { share: 0, text: "no year closed yet" };
      return { share: m.of > 1 ? (m.of - m.rank) / (m.of - 1) : 1, text: `${m.rank} of ${m.of} at the last close` };
    }
    case "nw100": {
      const nw = s.nwHistory.at(-1) ?? 0;
      return { share: Math.max(0, Math.min(1, nw / 100e6)), text: `$${(nw / 1e6).toFixed(1)}M of $100M` };
    }
    case "builder":
    case "developer": {
      const want = g.id === "builder" ? 5 : 15;
      const n = Math.max(0, (s.delivered ?? 0) - (g.base ?? 0));
      return { share: Math.min(1, n / want), text: `${n} of ${want} delivered` };
    }
    case "nw500": {
      const nw = s.nwHistory.at(-1) ?? 0;
      return { share: Math.max(0, Math.min(1, nw / 500e6)), text: `$${(nw / 1e6).toFixed(1)}M of $500M` };
    }
    case "manager": {
      // A vehicle raised after the goal was set, settled, and not a failure:
      // the LPs got their capital back and the pref on top.
      const f = s.fund && s.fund.raisedM >= g.setM ? s.fund : undefined;
      if (!f) return { share: 0, text: "no fund raised yet" };
      if (f.settled) return f.failed ? { share: 0, text: "the fund was wound up short — raise another" } : { share: 1, text: "returned" };
      const dpi = f.called > 0 ? f.distributed / f.called : 0;
      return { share: 0.5, text: `raised · ${dpi.toFixed(2)}x paid back so far` };
    }
    case "landlord": {
      // Your share of what is let: commercial suites on the roll, and the
      // flats (tracked as occupancy on the multifamily space, not as suites —
      // leaving them out missed a third of one measured book). Vehicle deeds
      // are the LPs'; a JV partner owns its share.
      let let_ = 0;
      for (const h of Object.values(s.holdings)) {
        if (h.fundOwned) continue;
        let sf = h.tenants.reduce((a, t) => a + t.sf, 0);
        const rec = parcels ? resolveRec(parcels, s, h.bbl) : null;
        if (rec && (h.occ ?? 0) > 0) sf += useRentableSf(rec, "multifamily") * (h.occ ?? 0);
        let_ += sf * (1 - (h.jv?.share ?? 0));
      }
      return { share: Math.min(1, let_ / 500_000), text: `${Math.round(let_).toLocaleString()} of 500,000 sf let` };
    }
  }
}

/** Has the goal just been met, or has its deadline passed? Pure read. */
export function goalVerdict(s: GameState, parcels?: ParcelTable | null): "done" | "failed" | null {
  const g = s.goal;
  if (!g || g.doneM !== undefined || g.failedM !== undefined) return null;
  const p = goalProgress(s, parcels);
  const met = g.id === "street"
    ? (s.yearMarks ?? []).some((m) => m.y >= 0 && m.m >= g.setM && m.rank === 1)
    : (p?.share ?? 0) >= 1;
  if (met) return "done";
  if (s.month > g.deadlineM) return "failed";
  return null;
}
