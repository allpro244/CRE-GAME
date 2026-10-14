/**
 * WHO OWNS THE EQUITY INSIDE ONE OF YOUR DEEDS (CAPITAL_RAISING_PLAN.md §12.1a).
 *
 * `ownership.ts` answers "who owns this deed?" for the whole city. This file
 * answers the question inside the player's own deeds: of the equity in this
 * building, how much is the sponsor's and how much belongs to a vehicle — the
 * fund (`fund.ts`) or a JV partner (`jv.ts`), and later deal-by-deal
 * syndications.
 *
 * Today that question is asked by hand in about twenty files, as
 * `h.fundOwned && s.fund && !s.fund.settled` in some and bare `h.fundOwned`
 * in others, and as `h.jv` / `jvShare` / `jvConsent` elsewhere. Those agree
 * today only because a fund settles once it owns no deeds (`tickFund`) and
 * the wind-down clears the flag on buy-in. Every new kind of vehicle would
 * multiply those branches, and one missed exit path means investors silently
 * unpaid. So the six questions get one answer each, here:
 *
 *   vehicleOf      is this deed in a live vehicle, and which
 *   sponsorShare   what share of its equity is the sponsor's own
 *   consentFor     can the sponsor act alone, and if not why
 *   purseOf        which cash account takes this deed's money
 *   routeProceeds  who gets what at an exit
 *   taxShare       what share of its taxable income is the sponsor's
 *
 * MIGRATION. This module is implemented on today's flags and nothing calls it
 * yet. Call sites move to it file by file, each move proven to change nothing
 * (same seeds, same end state); only then does the data model change.
 */
import type { GameState, Holding } from "./types";
import { gpCapitalShare } from "./fund";

// KEEP THIS MODULE LIGHT. It is imported by the valuation and books code
// (value.ts, books.ts, credit.ts), and those are imported by jv.ts and
// actions.ts. Importing either of those here closes a cycle that changes the
// bundle's module evaluation order, and a top-level constant read before its
// module has run comes out undefined, which turned net worth into NaN by
// month two (measured, the first batch of this migration). Only types and
// fund.ts (types, sponsor, money) belong above.

/** The refusal a JV partner gives on a major decision. Re-exported by jv.ts. */
export const JV_CONSENT = "Your partner has consent on that — buy them out first.";

export type VehicleRef =
  | { kind: "fund" }
  | { kind: "jv"; share: number; partner: string };

/** The live vehicle this deed sits in, or null when it is wholly the sponsor's. */
export function vehicleOf(s: GameState, h: Holding | undefined | null): VehicleRef | null {
  if (!h) return null;
  // A fund deed is the fund's while the fund lives. It cannot also carry a JV
  // partner (stakeQuote refuses a fund deed), so the order here is not a choice.
  if (h.fundOwned && s.fund && !s.fund.settled) return { kind: "fund" };
  if (h.jv) return { kind: "jv", share: h.jv.share, partner: h.jv.partner };
  return null;
}

/**
 * The share of this deed's equity that counts directly in the sponsor's own
 * net worth. A fund deed counts 0 here: the sponsor's interest in the vehicle
 * is read once, at the fund level, through the waterfall (`gpInterestInFund`).
 */
export function sponsorShare(s: GameState, h: Holding | undefined | null): number {
  const v = vehicleOf(s, h);
  if (!v) return 1;
  return v.kind === "fund" ? 0 : 1 - v.share;
}

/**
 * The share of this deed's equity a JV partner owns (0 when there is none).
 * Read directly rather than as `1 − sponsorShare`: in floating point
 * `1 − (1 − x)` is not always `x`, and the migration must change nothing.
 */
export function partnerShare(s: GameState, h: Holding | undefined | null): number {
  const v = vehicleOf(s, h);
  return v?.kind === "jv" ? v.share : 0;
}

/** The big decisions a vehicle can veto. */
export type ConsentAction =
  | "debt"          // new debt, payoff, paydown, mezz
  | "redevelop"     // demolition, renovation, conversion, adaptive reuse, groundbreak with site debt
  | "assemble"      // fold into an assemblage
  | "groundLease"   // offer or sell the land under it
  | "pledge"        // portfolio facility, package sale
  | "stake"         // sell a JV stake in it
  | "exchange";     // roll its gain into the sponsor's own 1031

/**
 * Can the sponsor take `action` on this deed alone? Null when it can; the
 * refusal, in the words the engine already uses, when it cannot.
 */
export function consentFor(s: GameState, h: Holding | undefined | null, action: ConsentAction): string | null {
  const v = vehicleOf(s, h);
  if (!v) return null;
  if (v.kind === "jv") return action === "exchange" ? null : JV_CONSENT;
  if (action === "stake") return "It is a fund deed — the fund's LPs are its partners.";
  if (action === "groundLease") return "The fund's documents do not allow selling the land out from under a vehicle deed.";
  if (action === "exchange") return "A fund deed's gain belongs to the vehicle — it cannot roll into your own 1031.";
  return null;
}

/** Which cash account takes this deed's money. */
export function purseOf(s: GameState, h: Holding | undefined | null): "sponsor" | "fund" {
  return vehicleOf(s, h)?.kind === "fund" ? "fund" : "sponsor";
}

/**
 * Who gets what when `toOwners` reaches the equity at an exit. A fund deed's
 * proceeds go to the vehicle whole; a JV partner takes its share of a
 * positive amount (a shortfall stays with the sponsor, as `ownersShareOfProceeds`
 * does today).
 */
export function routeProceeds(s: GameState, h: Holding | undefined | null, toOwners: number): { toSponsor: number; toVehicle: number; toPartner: number } {
  const v = vehicleOf(s, h);
  if (!v) return { toSponsor: toOwners, toVehicle: 0, toPartner: 0 };
  if (v.kind === "fund") return { toSponsor: 0, toVehicle: toOwners, toPartner: 0 };
  const toPartner = toOwners > 0 ? Math.round(toOwners * v.share) : 0;
  return { toSponsor: toOwners - toPartner, toVehicle: 0, toPartner };
}

/**
 * The share of this deed's taxable income and gains the sponsor reports. A
 * pass-through vehicle allocates to its partners: a fund deed's to the
 * sponsor at its co-invest share (`gpCapitalShare`), a JV deed's at the
 * sponsor's own share.
 */
export function taxShare(s: GameState, h: Holding | undefined | null): number {
  const v = vehicleOf(s, h);
  if (!v) return 1;
  return v.kind === "fund" ? gpCapitalShare(s.fund ?? undefined) : 1 - v.share;
}
