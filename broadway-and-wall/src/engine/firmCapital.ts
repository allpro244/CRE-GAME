/**
 * FIRM CAPITAL — what the firm has earned as an institution.
 *
 * Not XP. Not a skill tree. A readout of institutional standing already earned
 * in lender relationships, clean exits, the book, and whether a vehicle is
 * live. It is a readout only: nothing in the economy reads it. There are no
 * people in this game (owner decision, ECONOMY.md "Firms only"), so standing
 * belongs to the firm.
 */
import type { GameState } from "./types";

/** Labels only — keep in sync with MILESTONES in sim.ts (avoids an import cycle with sim.ts). */
const MILESTONE_LABELS: Record<string, string> = {
  deed1: "First deed recorded",
  lease1: "First lease signed",
  tower1: "First development delivered",
  exit1: "First profitable exit",
  nw25: "Net worth $25M",
  nw100: "Net worth $100M",
  nw500: "Net worth $500M",
  nw1b: "The billion-dollar book",
  ten: "Ten buildings under management",
  twentyfive: "A quarter-hundred holdings",
  half: "Fifty years in town",
  nw5b: "Five billion under management",
  fifty: "Fifty buildings under management",
  hundred: "A hundred deeds recorded",
  builder: "Twenty-five buildings of your own making",
  share: "A twentieth of the city's built stock",
  diamond: "Seventy-five years in town",
  sesqui: "A hundred and fifty years in town",
  bicent: "Two centuries in town",
};

export interface FirmPillar {
  id: string;
  label: string;
  /** 0..1 contribution toward maturity. */
  score: number;
  detail: string;
}

export interface FirmCapital {
  /** Integer 0–5 for UI. */
  tier: number;
  label: string;
  /** 0..1 continuous maturity. */
  score: number;
  pillars: FirmPillar[];
  milestonesHit: number;
  milestonesTotal: number;
}

export const TIER_LABEL = [
  "Startup shop",
  "Known locally",
  "Established firm",
  "Institutional name",
  "City fixture",
  "Legacy house",
] as const;

function cleanExits(s: GameState): number {
  return (s.exits ?? []).filter((e) => !e.forced && e.gain > 0).length;
}

function meanLenderRel(s: GameState): number {
  const rel = s.lenderRel ?? {};
  const vals = Object.values(rel);
  if (!vals.length) return 20; // default desk standing
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/**
 * Pure readout — no RNG, no mutation. Safe on every render.
 */
export function firmCapital(s: GameState): FirmCapital {
  const lender = meanLenderRel(s);
  const exits = cleanExits(s);
  const liveFund = !!(s.fund && !s.fund.settled);
  const fundRealised = !!(s.fund?.settled && !s.fund.failed && !s.fund.inKind);
  // Avoid netWorth(parcels) here — firmCapital is called from capacity paths that
  // sometimes lack a parcel table (harnesses). Last stamped NW or cash is enough.
  const nw = s.nwHistory?.length
    ? s.nwHistory[s.nwHistory.length - 1]!
    : (s.cash ?? 0);
  const holdingsN = Object.keys(s.holdings ?? {}).length;
  const milestonesHit = Object.keys(MILESTONE_LABELS)
    .filter((id) => s.milestones?.[id] !== undefined).length;

  const pillars: FirmPillar[] = [
    {
      id: "lender",
      label: "Lender standing",
      score: Math.max(0, Math.min(1, (lender - 20) / 80)),
      detail: valsDetail(lender),
    },
    {
      id: "exits",
      label: "Clean exits",
      score: Math.max(0, Math.min(1, exits / 8)),
      detail: exits === 0
        ? "No profitable voluntary exit on the record"
        : `${exits} clean exit${exits === 1 ? "" : "s"} — LPs and desks notice`,
    },
    {
      id: "vehicle",
      label: "Vehicle",
      // A FUND RETURNED IS A TRACK RECORD, not the absence of a fund. This
      // scored a successful wind-down 0 — the same as never having raised one
      // — so the firm stepped DOWN a tier the month its LPs were paid back.
      // A realised fund stands below a live one (no LP capital on the second
      // account today) and well above none: 0.75 is a shape choice, placed
      // between the two, not calibrated to a measured outcome.
      score: liveFund ? 1 : (s.fundFailedM !== undefined ? 0.15 : fundRealised ? 0.75 : 0),
      detail: liveFund
        ? "Live fund — LP capital on a second account"
        : s.fundFailedM !== undefined
          ? "A prior vehicle failed — the street remembers"
          : fundRealised
            ? "A fund raised and returned — a track record LPs can underwrite"
            : "No fund raised yet",
    },
    {
      id: "book",
      label: "Book",
      score: Math.max(0, Math.min(1,
        0.55 * Math.min(1, Math.log10(Math.max(1, nw)) / 9)
        + 0.45 * Math.min(1, holdingsN / 40))),
      detail: nw >= 1e9
        ? "Billion-dollar book"
        : holdingsN >= 10
          ? `${holdingsN} deeds · building the book`
          : holdingsN === 0
            ? "No deeds yet"
            : "Still building the book",
    },
  ];

  const score = pillars.reduce((a, p) => a + p.score, 0) / pillars.length;
  const tier = Math.max(0, Math.min(5, Math.floor(score * 6 - 1e-9)));

  return {
    tier,
    label: TIER_LABEL[tier],
    score,
    pillars,
    milestonesHit,
    milestonesTotal: Object.keys(MILESTONE_LABELS).length,
  };
}

function valsDetail(lender: number): string {
  if (lender >= 70) return "Desks know your name — paper prices it";
  if (lender >= 40) return "Ordinary banking relationships";
  return "Thin file with the lenders in town";
}

/** Named milestones already struck — for the firm's standing panel. */
export function firmMilestonesHit(s: GameState): { id: string; label: string; atM: number }[] {
  const out: { id: string; label: string; atM: number }[] = [];
  for (const [id, label] of Object.entries(MILESTONE_LABELS)) {
    const at = s.milestones?.[id];
    if (at !== undefined) out.push({ id, label, atM: at });
  }
  return out.sort((a, b) => a.atM - b.atM);
}

/** Next milestone label not yet stamped (coaching line). */
export function nextFirmMilestone(s: GameState): { id: string; label: string } | null {
  for (const [id, label] of Object.entries(MILESTONE_LABELS)) {
    if (s.milestones?.[id] === undefined) return { id, label };
  }
  return null;
}
