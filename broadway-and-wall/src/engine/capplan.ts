/**
 * THE CAPITAL PLAN, FORWARD. What the monthly tick in leasing.ts will do to a
 * building's condition under each plan, year by year, and what that condition
 * is worth in rent, tenant pull and value at today's market.
 *
 * Nothing here is a new number. The step is the tick's own: condWear off,
 * wear × planSpec(plan).lift back on when the plan is funded, clamped to
 * [0.20, condCeiling] — and the bill is capPlanBillMo at the building's value
 * today (the tick re-reads value monthly; holding it fixed is the one
 * simplification, and it is stated on screen as "at today's value"). A
 * programme (dev.ts) lands PROGRAM_LIFT on completion, as tickPrograms does.
 * Rent, draw and value are the engine's own readers at the projected index:
 * marketRentPsfYr, scoreDraw(overallScore), assetValue.
 */
import type { ParcelRecord } from "@/data/types";
import type { BuiltClass, GameState, Holding } from "./types";
import { OPS_PLAN, planSpec } from "./types";
import { assetValue, capPlanBillMo, condCeiling, condGrade, condWear, initialCondIdx, marketRentPsfYr, overallScore } from "./value";
import { PROGRAMS, PROGRAM_CYCLE_M, PROGRAM_LIFT, programCost } from "./dev";
import { scoreDraw } from "./bands";
import { dominantUse } from "./mix";

export interface CapYear { yr: number; spend: number; condIdx: number }
export interface CapRead { condIdx: number; grade: string; rentPsf: number; draw: number; value: number }
export interface CapPath {
  plan: 0 | 1 | 2;
  label: string;
  years: CapYear[];
  total: number;
  end: CapRead;
}

/** What a building at this condition index reads as, at today's market. */
export function capRead(s: GameState, rec: ParcelRecord, condIdx: number): CapRead {
  const grade = condGrade(condIdx);
  const use = dominantUse(rec) as BuiltClass;
  return {
    condIdx,
    grade,
    rentPsf: marketRentPsfYr(rec, s.econ, grade, condIdx),
    draw: scoreDraw(s.econ, use, overallScore(rec, s.econ, use, condIdx)),
    value: assetValue(rec, s.econ, grade, condIdx),
  };
}

/** Month by month, as the tick runs it; one row per year. `bump` lifts the index once, at `bumpM` months out (a programme). */
export function capPath(
  s: GameState, rec: ParcelRecord, h: Holding, gav: number, plan: 0 | 1 | 2, years = 10,
  bump?: { atM: number; lift: number },
): CapPath {
  const spec = planSpec(plan);
  let idx = h.condIdx ?? initialCondIdx(rec, h.boughtM, h.condition);
  const out: CapYear[] = [];
  let total = 0;
  for (let y = 0; y < years; y++) {
    let spend = 0;
    for (let m = 0; m < 12; m++) {
      const k = y * 12 + m;
      const q = s.month + k + 1;
      const wear = condWear(rec, q);
      idx -= wear;
      const bill = capPlanBillMo(gav, wear, spec.mult);
      if (bill > 0) { spend += bill; idx += wear * spec.lift; }
      if (bump && k + 1 === bump.atM) idx = Math.min(condCeiling(rec, q), idx + bump.lift);
      idx = Math.max(0.20, Math.min(condCeiling(rec, q), idx));
    }
    total += spend;
    out.push({ yr: y + 1, spend, condIdx: idx });
  }
  return { plan, label: spec.label, years: out, total, end: capRead(s, rec, idx) };
}

export function capPaths(s: GameState, rec: ParcelRecord, h: Holding, gav: number, years = 10): CapPath[] {
  return OPS_PLAN.map((o) => capPath(s, rec, h, gav, o.key, years));
}

export interface ProgRow { id: string; label: string; cost: number; months: number; lift: number; end: CapRead; /** the month it next comes due, when it has been done */ dueM: number | null; running: boolean }

/** Each programme on the plan in force: its cost, and the building ten years on if it is started now. */
export function programRows(s: GameState, rec: ParcelRecord, h: Holding, gav: number, years = 10): ProgRow[] {
  return PROGRAMS.map((p) => {
    const lift = PROGRAM_LIFT[p.id] ?? 0;
    const end = capPath(s, rec, h, gav, h.plan ?? 1, years, { atM: p.months, lift }).end;
    const done = h.programsDone?.[p.id];
    return { id: p.id, label: p.label, cost: programCost(rec, s, p), months: p.months, lift, end, dueM: done !== undefined ? done + (PROGRAM_CYCLE_M[p.id] ?? 240) : null, running: h.program?.id === p.id };
  });
}
