// THINGS THAT HAPPEN TO BUILDINGS.
//
// Nothing had ever damaged one. A hundred years could pass in a port town, on
// a shoreline, and no building ever burned, flooded or lost a roof — condition
// drifted down slowly with age and that was the whole of physical risk.
// Insurance appeared in this codebase twice: as a line in the operating
// expense stack and as the name of a lender. There was no coverage decision,
// no deductible, no business interruption, and nothing you could fail to
// insure and then regret.
//
// Three perils, and they are different shapes of risk on purpose:
//
//   FIRE   — one building at a time, uncorrelated, and the one peril an old
//            building in poor condition genuinely brings on itself.
//   STORM  — a CITY event. It hits everything at once, harder on the water,
//            and it is what turns a deductible from a footnote into the most
//            important number on the policy: you pay it per building.
//   FLOOD  — rare, waterfront only, severe, and the one a lot of owners
//            decline to insure because the premium looks absurd right up
//            until the water comes over the quay.
//
// The decision the player actually makes is the same one every real owner
// makes: how much risk to keep. A low deductible is expensive and quiet; a
// high one is cheap and occasionally ruinous; declining flood cover on a
// waterfront book is free money for years and then it is not.
import type { ParcelTable } from "@/data/types";
import type { GameState, Holding, Peril } from "./types";
import { logBooks, monthLabel } from "./types";
import { rng, rrange } from "./market";
import { resolveRec, holdingValue } from "./value";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Deductible tiers, as a share of the insured value of the damaged building. */
export const DEDUCTIBLES = [0.01, 0.025, 0.05, 0.10] as const;

/**
 * The base premium rate on insured value, before your own exposure and your
 * own claims history. Roughly a fifth of a point for ordinary cover, which is
 * about what a real commercial programme costs — and it is charged on the
 * whole book, every month, whether anything happens or not.
 */
// Calibrated against what the perils below actually cost. At the old rate the
// programme ran a 35% loss ratio across fifty years — the insurer's dream and
// nobody's idea of a market. Real commercial property runs 50-70%, so the
// premium is a genuine transfer of risk rather than a tax on owning things.
const BASE_RATE = 0.0013;
// Flood is priced separately and dearly, because it is rare and total. This is
// the number that makes declining cover genuinely tempting — which is the
// whole decision, and it was not tempting at all when the load was small
// enough to be rounding on the main premium.
const FLOOD_LOAD = 0.0115;

export interface InsuranceQuote {
  insuredValue: number;
  floodExposure: number;    // share of the book that is genuinely on the water
  premiumYr: number;
  deductiblePct: number;
  flood: boolean;
  experience: number;       // 1.0 clean; rises with claims
}

export function insuredValue(s: GameState, parcels: ParcelTable): number {
  let v = 0;
  for (const h of Object.values(s.holdings)) {
    const rec = resolveRec(parcels, s, h.bbl);
    if (!rec || rec.class === "land" || !rec.bldgArea) continue;
    // You insure the BUILDING, not the land. Nobody writes a policy on dirt.
    v += Math.max(0, holdingValue(rec, s.econ, h, s.month) * 0.72);
  }
  return v;
}

export function floodExposure(s: GameState, parcels: ParcelTable): number {
  let v = 0, exposed = 0;
  for (const h of Object.values(s.holdings)) {
    const rec = resolveRec(parcels, s, h.bbl);
    if (!rec || rec.class === "land" || !rec.bldgArea) continue;
    const val = Math.max(0, holdingValue(rec, s.econ, h, s.month));
    v += val;
    exposed += val * (rec.floodRisk ?? 0);
  }
  return v > 0 ? exposed / v : 0;
}

export function insuranceQuote(
  s: GameState, parcels: ParcelTable, deductiblePct: number, flood: boolean,
): InsuranceQuote {
  const iv = insuredValue(s, parcels);
  const fx = floodExposure(s, parcels);
  // A bigger deductible is cheaper, and the discount is real but not linear —
  // the first losses are the frequent ones and that is what you are buying off.
  const dedFactor = 1.35 - 3.6 * clamp(deductiblePct, 0.005, 0.15);
  // EXPERIENCE RATING. Underwriters remember. Three claims in a decade and you
  // are paying for them for the decade after.
  const experience = 1 + clamp((s.insurance?.claims ?? 0) * 0.09, 0, 0.9);
  // and the insurance market has its own cycle, roughly opposite to credit
  const hard = 1 + 0.35 * (1 - clamp(s.econ.creditIdx ?? 1, 0.5, 1.2));
  const base = iv * BASE_RATE * Math.max(0.35, dedFactor) * experience * hard;
  const floodPart = flood ? iv * fx * FLOOD_LOAD * experience * hard : 0;
  return {
    insuredValue: Math.round(iv),
    floodExposure: fx,
    premiumYr: Math.round(base + floodPart),
    deductiblePct, flood, experience,
  };
}

export function setInsurance(
  s: GameState, parcels: ParcelTable, deductiblePct: number, flood: boolean,
): { s: GameState; err?: string; msg?: string } {
  const next: GameState = JSON.parse(JSON.stringify(s));
  const q = insuranceQuote(next, parcels, deductiblePct, flood);
  next.insurance = {
    deductiblePct, flood,
    claims: next.insurance?.claims ?? 0,
    sinceM: next.month,
    premiumYr: q.premiumYr,
    paidTotal: next.insurance?.paidTotal ?? 0,
    recoveredTotal: next.insurance?.recoveredTotal ?? 0,
  };
  return { s: next, msg: `Bound at ${(q.premiumYr / 1e6).toFixed(2)}M a year.` };
}

// ------------------------------------------------------------------ the perils

const PERIL_WORD: Record<Peril, string> = {
  fire: "a fire", storm: "the storm", flood: "the flood",
};

/**
 * Put a building out of service. `share` is how much of it is unusable; the
 * damaged part earns nothing until the repair is done, and the repair costs
 * real money whether or not anybody is paying for it.
 */
function damage(s: GameState, parcels: ParcelTable, h: Holding, peril: Peril, share: number) {
  const rec = resolveRec(parcels, s, h.bbl);
  if (!rec || rec.class === "land" || !rec.bldgArea) return;
  const sh = clamp(share, 0.05, 1);
  const value = Math.max(0, holdingValue(rec, s.econ, h, s.month));
  // Rebuilding costs what building costs, not what the thing is worth — which
  // is why a cheap building in an expensive market is the one that hurts.
  const cost = Math.round(rec.bldgArea * sh * 145 * s.econ.costIdx);
  const months = Math.max(2, Math.round(3 + sh * 16));

  const pol = s.insurance;
  const covered = !!pol && (peril !== "flood" || pol.flood);
  const ded = covered ? Math.round(value * 0.72 * (pol!.deductiblePct)) : 0;
  const recovery = covered ? Math.max(0, cost - ded) : 0;

  s.cash -= cost;
  logBooks(s, "capex", cost);
  if (recovery > 0) {
    s.cash += recovery;
    logBooks(s, "capex", -recovery);
    s.insurance!.recoveredTotal += recovery;
    s.insurance!.claims += 1;
  }
  h.damage = { peril, share: sh, untilM: s.month + months, uninsured: covered ? ded : cost };
  // A building that has burned is not the building it was, even repaired.
  if (sh > 0.4 && h.condition === "good") h.condition = "standard";

  // Tenants in the damaged part do not sit in the rubble waiting.
  if (sh > 0.25 && h.tenants.length) {
    const kill = Math.round(h.tenants.length * sh * 0.6);
    for (let i = 0; i < kill && h.tenants.length; i++) {
      const idx = Math.floor(rng(s) * h.tenants.length);
      h.tenants.splice(idx, 1);
    }
  }

  s.news.unshift({
    q: s.month, kind: "warn",
    text: `${PERIL_WORD[peril]} at ${rec.address}: ${(sh * 100).toFixed(0)}% of the building is out of service until ${monthLabel(s.month + months)}. `
      + `Repairs are $${(cost / 1e6).toFixed(2)}M`
      + (covered
        ? `, of which the policy pays $${(recovery / 1e6).toFixed(2)}M — you carry the $${(ded / 1e6).toFixed(2)}M deductible.`
        : peril === "flood"
          ? `, and you declined flood cover. All of it is yours.`
          : `, and you carry no insurance at all. All of it is yours.`),
  });
}

/**
 * A month of weather, wiring and bad luck.
 *
 * Storms are drawn once for the whole city and then applied building by
 * building, which is the entire point: a deductible you barely noticed on one
 * fire is charged on every building you own when the same storm hits them all.
 */
export function tickPerils(s: GameState, parcels: ParcelTable) {
  // repairs finish
  for (const h of Object.values(s.holdings)) {
    if (h.damage && s.month >= h.damage.untilM) {
      const rec = resolveRec(parcels, s, h.bbl);
      delete h.damage;
      s.news.unshift({
        q: s.month, kind: "info",
        text: `Repairs are complete at ${rec?.address ?? h.bbl}. The space is back on the market.`,
      });
    }
  }

  // the premium, monthly, whether anything happens or not
  if (s.insurance) {
    // repriced on the book as it actually stands, once a year
    if (s.month % 12 === 0) {
      s.insurance.premiumYr = insuranceQuote(s, parcels, s.insurance.deductiblePct, s.insurance.flood).premiumYr;
    }
    const m = s.insurance.premiumYr / 12;
    if (m > 0) {
      s.cash -= m;
      s.insurance.paidTotal += m;
      logBooks(s, "ga", m);
    }
  }

  const owned = Object.values(s.holdings).filter((h) => {
    const rec = resolveRec(parcels, s, h.bbl);
    return rec && rec.class !== "land" && rec.bldgArea > 0 && !h.damage;
  });
  if (!owned.length) return;

  // ---- fire: one building at a time -----------------------------------------
  for (const h of owned) {
    const rec = resolveRec(parcels, s, h.bbl)!;
    const age = Math.max(0, 2000 + Math.floor(s.month / 12) - rec.yearBuilt);
    const wear = h.condition === "worn" ? 2.4 : h.condition === "standard" ? 1.3 : 0.7;
    const p = 0.00018 * wear * (1 + Math.min(1.4, age / 90));
    if (rng(s) < p) damage(s, parcels, h, "fire", rrange(s, 0.1, 0.75));
  }

  // ---- storm: everything at once --------------------------------------------
  // Roughly one real blow a decade, and one that does serious damage far less
  // often than that. The city hears about it whether or not you own anything
  // in its path.
  if (rng(s) < 0.0075) {
    const severity = rrange(s, 0.25, 1);
    s.news.unshift({
      q: s.month, kind: "warn",
      text: severity > 0.7
        ? `A major storm has come up the coast. The waterfront took the worst of it and every owner in this town is counting roofs this morning.`
        : `A storm blew through overnight. Nothing catastrophic, but the assessors will be busy.`,
    });
    for (const h of owned) {
      const rec = resolveRec(parcels, s, h.bbl)!;
      const exposure = 0.35 + 0.9 * (rec.floodRisk ?? 0);
      if (rng(s) < severity * exposure * 0.5) {
        damage(s, parcels, h, "storm", rrange(s, 0.05, 0.35) * severity);
      }
    }
  }

  // ---- flood: the water comes over the quay ---------------------------------
  // Rarer than a storm and far worse when it comes: roughly once in fifty
  // years, and the buildings it reaches are not damaged, they are under water.
  if (rng(s) < 0.0016) {
    const exposed = owned.filter((h) => (resolveRec(parcels, s, h.bbl)?.floodRisk ?? 0) > 0.2);
    if (exposed.length) {
      s.news.unshift({
        q: s.month, kind: "warn",
        text: `The water came over the quay. Anything low and near it is under water this morning, and the people who declined flood cover are finding out what that was worth.`,
      });
      for (const h of exposed) {
        const rec = resolveRec(parcels, s, h.bbl)!;
        if (rng(s) < (rec.floodRisk ?? 0) * 0.8) {
          // A flooded ground floor is the whole building's problem: the plant
          // is in the basement, the lifts are out, and nobody is trading out
          // of the upper floors either.
          damage(s, parcels, h, "flood", rrange(s, 0.45, 1) * (0.55 + 0.45 * (rec.floodRisk ?? 0)));
        }
      }
    }
  }
}

/** Lifetime picture, for the books. */
export function insuranceSummary(s: GameState) {
  const p = s.insurance;
  if (!p) return null;
  return {
    ...p,
    net: (p.recoveredTotal ?? 0) - (p.paidTotal ?? 0),
  };
}
