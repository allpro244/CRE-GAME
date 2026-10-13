// THE STORY LAYER — COMPETITORS_PLAN.md §6.
//
// Thirty-five firms in a league table is a spreadsheet. A city worth watching
// has a cast: the handful of firms that matter to you right now, what each one
// is in the middle of, and what is about to happen to it. This file reads
// that out of state that already exists — balance sheets, hold clocks, the
// maturity ladder, the construction pipeline, the ledger between you and each
// firm — and decides nothing. It draws no RNG and writes nothing to the game
// except the annual equity mark the race chart needs (`markEquityYear`), so
// choosing whom to SHOW can never move the economy.
import type { ParcelTable } from "@/data/types";
import { thesisLabel } from "./strategy";
import type { GameState, Rival } from "./types";
import { START_YEAR } from "./types";
import { livingRivals, markRival, paramsOf, nextBalloonM, holdClockM, sheetOf } from "./rivals";
import { nearestProfile, PROFILE_OF, RULE_LABEL, PUBLIC_RULES } from "./competitorTraits";
import { money } from "./money";

export type Role = "nemesis" | "neighbour" | "highFlyer" | "circling" | "upstart";

export const ROLE_LABEL: Record<Role, string> = {
  nemesis: "Nemesis",
  neighbour: "Neighbour",
  highFlyer: "High-flyer",
  circling: "Circling",
  upstart: "Upstart",
};

export type Arc =
  | "raising" | "deploying" | "overreaching" | "strained" | "crisis"
  | "rescued" | "fireSale" | "foreclosed" | "takenOver" | "steady";

export const ARC_LABEL: Record<Arc, string> = {
  raising: "Raising",
  deploying: "Deploying",
  overreaching: "Overreaching",
  strained: "Strained",
  crisis: "Crisis",
  rescued: "Rescued",
  fireSale: "Fire sale",
  foreclosed: "Foreclosed",
  takenOver: "Taken over",
  steady: "Steady",
};

/** Where a firm is in its story, from signals the engine already keeps. */
export function arcOf(s: GameState, r: Rival, ltv: number): Arc {
  if (r.failedM !== undefined) return r.takenPrivateM !== undefined || r.takenOverBy ? "takenOver" : r.retiredM !== undefined ? "steady" : "foreclosed";
  const stress = r.stressMs ?? 0;
  if (stress >= 6) return "crisis";
  if (stress > 0) return r.backerUsedM !== undefined && s.month - r.backerUsedM < 12 ? "rescued" : "strained";
  const age = s.month - (r.bornM ?? 0);
  if (r.bornM > 0 && age < 6) return "raising";
  if ((r.uncalled ?? 0) > 0 && age < 36) return "deploying";
  const max = paramsOf(r).maxLtv;
  if (max > 0 && ltv > max * 0.9) return "overreaching";
  return "steady";
}

export interface Headliner {
  r: Rival;
  arc: Arc;
  why: string;
  coming: string[];
  /** Profile label as the numbers read today (§4 drift). */
  label: string;
  /** The role it was picked for; absent for the giants that fill the strip. */
  role?: Role;
}

/**
 * WHO MATTERS RIGHT NOW. Scores every living firm for each role and fills
 * the roles in order, one firm per role, up to six. Pure; call it on render.
 */
export function headliners(s: GameState, parcels: ParcelTable, max = 6): Headliner[] {
  const live = livingRivals(s);
  if (!live.length) return [];
  const marks = new Map(live.map((r) => [r, markRival(s, parcels, r)]));
  const mine = new Set(Object.keys(s.holdings));
  const myDistricts = new Set<string>();
  const myBlocks = new Set<string>();
  for (const b of mine) {
    const rec = parcels[b];
    if (rec) { myDistricts.add(rec.district); if (rec.block) myBlocks.add(rec.block); }
  }
  const ci = s.econ.creditIdx ?? 1;
  const score: Record<Role, (r: Rival) => number> = {
    nemesis: (r) => {
      const t = s.street?.[r.id];
      // holding your defaulted paper makes a firm your nemesis outright
      const paper = (s.firmHeldLoans ?? []).filter((x) => x.firmId === r.id).length * 10;
      return (t ? t.beats * 2 + t.insults - t.deals * 0.5 : 0) + paper;
    },
    neighbour: (r) => {
      let n = 0;
      for (const b of r.bbls) {
        const rec = parcels[b];
        if (!rec) continue;
        if (rec.block && myBlocks.has(rec.block)) n += 3;
        else if (myDistricts.has(rec.district)) n += 1;
      }
      for (const j of s.cityJobs ?? []) {
        if (j.firmId !== r.id) continue;
        const rec = parcels[j.bbl];
        if (rec && (myBlocks.has(rec.block) || myDistricts.has(rec.district))) n += 3;
      }
      return n;
    },
    highFlyer: (r) => (ci >= 1 ? (marks.get(r)!.ltv) * 10 : 0),
    circling: (r) => {
      const p = paramsOf(r);
      const distressOnTape = s.listings.filter((l) => l.distress).length;
      return p.distressBias >= 1.8 && r.cash > 0 ? distressOnTape + (1 - ci) * 10 : 0;
    },
    upstart: (r) => (r.bornM > 0 && s.month - r.bornM < 120 ? 10 - (s.month - r.bornM) / 12 + r.bbls.length * 0.3 : 0),
  };
  const roles: Role[] = ["nemesis", "neighbour", "highFlyer", "circling", "upstart"];
  const taken = new Set<Rival>();
  const out: Headliner[] = [];
  for (const role of roles) {
    let best: Rival | null = null, bs = 0;
    for (const r of live) {
      if (taken.has(r)) continue;
      const v = score[role](r);
      if (v > bs) { bs = v; best = r; }
    }
    if (!best) continue;
    taken.add(best);
    out.push(headline(s, parcels, best, role, marks.get(best)!.ltv));
  }
  // fill to `max` with the biggest firms not yet shown — the city's giants
  const rest = live.filter((r) => !taken.has(r))
    .sort((a, b) => (marks.get(b)!.aum - b.debt) - (marks.get(a)!.aum - a.debt));
  for (const r of rest) {
    if (out.length >= max) break;
    out.push(headline(s, parcels, r, undefined, marks.get(r)!.ltv, "One of the biggest books in town"));
  }
  return out;
}

function headline(s: GameState, parcels: ParcelTable, r: Rival, role: Role | undefined, ltv: number, why?: string): Headliner {
  return {
    r, role, arc: arcOf(s, r, ltv),
    why: why ?? (role ? whyLine(s, r, role) : ""),
    coming: comingFor(s, parcels, r, ltv),
    label: labelOf(r),
  };
}

/**
 * WHAT A FIRM READS AS TODAY. The profile it was drawn from, until its
 * numbers drift far enough that another profile describes it better (§4).
 */
export function labelOf(r: Rival): string {
  if (!r.sheet) return PROFILE_OF[legacyProfile(r)].label;
  return nearestProfile(r.sheet).label;
}

/** A legacy firm, read as the profile closest to its style row. */
function legacyProfile(r: Rival) {
  return nearestProfile(sheetOf(r)).id;
}

function whyLine(s: GameState, r: Rival, role: Role): string {
  const t = s.street?.[r.id];
  switch (role) {
    case "nemesis": return t ? `Beat you ${t.beats} time${t.beats === 1 ? "" : "s"}${t.insults ? `, and you have insulted them ${t.insults}` : ""}` : "Your most frequent opponent";
    case "neighbour": return "Owns or is building next to your book";
    case "highFlyer": return "The most levered book in a boom";
    case "circling": return "A distress buyer with cash, and distress on the tape";
    case "upstart": return `Raised in ${START_YEAR + Math.floor(r.bornM / 12)} and growing`;
  }
}

/**
 * WHAT'S COMING — read-only foreshadowing (§6.3). Each line is a fact the
 * engine already holds, said before it resolves.
 */
export function comingFor(s: GameState, parcels: ParcelTable, r: Rival, ltv: number): string[] {
  const out: string[] = [];
  // YOUR PAPER IN THEIR HANDS — the line that matters most, first.
  for (const x of s.firmHeldLoans ?? []) {
    if (x.firmId !== r.id) continue;
    const w = s.workouts?.[x.bbl];
    const addr = parcels[x.bbl]?.address ?? x.bbl;
    out.push(w?.stage === "foreclosure" && w.saleM !== undefined
      ? `Has filed on your loan at ${addr} — the auction is ${START_YEAR + Math.floor(w.saleM / 12)}`
      : `Holds your defaulted loan on ${addr}, and wants the building`);
  }
  const yr = (m: number) => START_YEAR + Math.floor(m / 12);
  // its plan for the next few years (strategy.ts)
  if (r.thesis) out.push(thesisLabel(r.thesis));
  // hold clock
  const hold = holdClockM(r);
  if (hold > 0) {
    let due = 0;
    for (const b of r.bbls) {
      const since = r.heldSince?.[b];
      if (since !== undefined && since + hold - s.month <= 24 && since + hold - s.month > 0) due++;
    }
    if (due) out.push(`Must exit ${due} building${due === 1 ? "" : "s"} by ${yr(s.month + 24)} on its hold clock`);
  }
  // balloons
  let nB = 0;
  for (const b of r.bbls) {
    const m = nextBalloonM(s, r, b);
    if (m !== undefined && m - s.month <= 12 && m >= s.month) nB++;
  }
  if (nB) out.push(`${nB} balloon${nB === 1 ? "" : "s"} due within a year, book at ${(ltv * 100).toFixed(0)}% LTV`);
  // assembly
  const byBlock = new Map<string, number>();
  for (const b of r.bbls) { const k = parcels[b]?.block; if (k) byBlock.set(k, (byBlock.get(k) ?? 0) + 1); }
  for (const [block, n] of byBlock) {
    if (n < 2) continue;
    const total = Object.values(parcels).filter((p) => p.block === block).length;
    if (total > n && (r.sheet?.assembly ?? 0) >= 50) {
      const sample = Object.values(parcels).find((p) => p.block === block);
      out.push(`Holds ${n} of ${total} lots on the block at ${sample?.address ?? block}`);
      break;
    }
  }
  // pipeline
  for (const j of s.cityJobs ?? []) {
    if (j.firmId !== r.id || j.orphaned) continue;
    const rec = parcels[j.bbl];
    const months = j.deliverM - s.month;
    if (months > 0 && months <= 18) {
      out.push(`Tops out at ${rec?.address ?? j.bbl} in ${months} month${months === 1 ? "" : "s"} — ${(j.sf / 1000).toFixed(0)}k sf of ${j.use}`);
    }
  }
  // cash to deploy
  if ((r.uncalled ?? 0) > 1_000_000) out.push(`${money(r.uncalled!)} of LP commitments still to call`);
  return out.slice(0, 3);
}

/** Rules a viewer can see — the public ones, always; the rest once revealed. */
export function shownRules(r: Rival): string[] {
  return (r.rules ?? []).filter((x) => PUBLIC_RULES.has(x)).map((x) => RULE_LABEL[x]);
}

/**
 * THE BEATS BETWEEN TWO MONTHS — what a spectator would want the clock to
 * stop for (§6.4, §7). Only things that happened to a firm: it went under, it
 * fell into crisis, a backer saved it, a new firm raised, a tower topped out.
 * Pure: compares the state before and after a month.
 */
export function beatsBetween(prev: GameState, next: GameState): string[] {
  const out: string[] = [];
  const before = new Map((prev.rivals ?? []).map((r) => [r.id, r]));
  for (const r of next.rivals ?? []) {
    const p = before.get(r.id);
    if (!p) { out.push(`${r.name} has raised a fund and is buying`); continue; }
    if (r.failedM !== undefined && p.failedM === undefined) {
      const by = r.takenOverBy ? (next.rivals ?? []).find((x) => x.id === r.takenOverBy)?.name : undefined;
      out.push(r.retiredM !== undefined ? `${r.name} has wound up and the family is keeping the buildings`
        : by ? `${by} has bought ${r.name} outright`
        : r.takenPrivateM !== undefined ? `${r.name} is yours` : `${r.name} has gone under — its book goes to the receivers`);
    }
    else if ((r.stressMs ?? 0) >= 6 && (p.stressMs ?? 0) < 6) out.push(`${r.name} is six months behind on its debt`);
    if (r.backerUsedM !== undefined && p.backerUsedM === undefined) out.push(`A backer nobody knew about has rescued ${r.name}`);
  }
  for (const j of prev.cityJobs ?? []) {
    if (!j.firmId || j.orphaned || j.deliverM !== next.month) continue;
    const r = (next.rivals ?? []).find((x) => x.id === j.firmId);
    if (r) out.push(`${r.name} has delivered ${(j.sf / 1000).toFixed(0)}k sf of ${j.use}`);
  }
  return out;
}
