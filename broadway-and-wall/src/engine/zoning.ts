// ZONING IS NOT A CONSTANT.
//
// `farMaxComm` and `farMaxRes` were stamped on at generation and never moved
// again, for a hundred years, in a city that grew from half-empty to built
// out. That is the least realistic thing left in the model: a rezoning is the
// largest single value event that can happen to a piece of dirt — larger than
// any building you would put on it — and there was no such thing.
//
// USE is free: any lot may host any use (value.ts zonePermits), outside the
// region's R-1/R-2 plats. DENSITY is zoned: every lot carries an FAR limit
// (farMaxComm / farMaxRes), and the variance desk below hears applications
// for more.
//
// Three mechanisms, and they are deliberately different in who drives them:
//
//   REZONING   — the CITY acts, on districts, over years: the plan commission
//                upzones a district whose recent buildings are built out to
//                the code (towngrowth.ts tickPlanning, PLAN). You do not
//                control it, you read it, and if you own the dirt when it
//                lands you did very well without doing anything. The district
//                walk that used to live in this file is gone.
//   VARIANCE   — YOU act, on one site. Lawyers, hearings, months of waiting
//                and a real chance of refusal. This is the natural partner to
//                assembling a site: you put the lots together, then you go
//                and ask for the envelope that makes them worth putting
//                together.
//   LANDMARK   — the city acts, on ONE BUILDING, and it is not a gift. The
//                redevelopment option is gone permanently; what you get back
//                is a building people care about, at a rent premium, that you
//                are no longer allowed to knock down.
import type { ParcelTable } from "@/data/types";
import type { GameState, VarianceApplication } from "./types";
import { monthLabel, cloneState} from "./types";
import { hash01 } from "./competitorTraits";
import { rng } from "./market";
import { resolveRec, landValue, demandLinear, landRead, landReadAsIf, envelopeRealisation, marketAppraisal, initialCondition } from "./value";
import { recordPropertyEvent } from "./history";
import { spendable, fundAndBook } from "./credit";
import { money } from "./money";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** How far a district's envelope can be moved, either way, over a century. */
// A district can be held down but not gutted: repeated downzonings were
// taking whole neighbourhoods to 57% of their original envelope, which is not
// planning, it is demolition by paperwork.
export const FAR_FLOOR = 0.72;
/** District envelope can reach ~gen cap as the city densifies — was 2.6× (~year 50 plateau). */
// EXPORTED BECAUSE TWO OTHER FILES BOUND THIS QUANTITY AND BOTH HAD GONE
// STALE. When the ceiling moved 2.6 -> 3.8 the invariant in invariants.ts went
// on refusing anything over 3 — so the engine could legally reach a state its
// own gate called impossible, and only a run longer than the gate's 120-month
// horizon would have found it — and test/zoning.mjs went on asserting a 2.6
// band that the engine had stopped promising. A bound restated in three places
// is the same number with three answers; there is one now, and it lives here
// with the process that enforces it.
export const FAR_CEIL = 3.8;

// ------------------------------------------------------------------ rezoning

/**
 * NOTHING TO DO HERE. Use is unzoned (value.ts zonePermits); density is not —
 * every lot carries an FAR limit. District rezoning moved to towngrowth.ts
 * (tickPlanning, PLAN); the walk, the manufacturing map and its reverse that
 * lived here are gone. This no-op stays because the planning tick below calls
 * it. resolveRec still applies `zoneAdj` (written now by towngrowth's plan
 * commission) and an old save's `zoneUse`.
 */
export function tickZoning(s: GameState, parcels: ParcelTable, bbls: string[]) {
  void s; void parcels; void bbls;
}

// ------------------------------------------------------------------ variance

function pendingVariances(s: GameState): Record<string, VarianceApplication> {
  if (s.varianceApps) return s.varianceApps;
  return s.varianceApp ? { [s.varianceApp.bbl]: s.varianceApp } : {};
}

/** What it costs to try, and what the odds actually are. */
export function varianceQuote(
  s: GameState, parcels: ParcelTable, bbl: string, targetFar?: number,
) {
  const rec = resolveRec(parcels, s, bbl);
  if (!rec || !rec.lotArea) return null;
  if (s.landmarks?.[bbl] !== undefined) return null;
  const land = landValue(rec, s.econ);
  const current = Math.max(rec.farMaxComm, rec.farMaxRes, 2);
  // ONE APPLICATION ASKS FOR A TENTH MORE AT LEAST AND THREE TIMES THE
  // CURRENT ENVELOPE AT MOST. Returned with the quote so the panel's slider
  // reads these bounds instead of restating them.
  const minTarget = current * 1.10;
  const maxTarget = current * 3;
  if (maxTarget <= current + 0.05) return null;
  const target = clamp(
    Number.isFinite(targetFar as number) ? (targetFar as number) : current * 1.34,
    minTarget,
    maxTarget,
  );
  const askShare = target / current - 1;
  // Lawyers, an architect, an expediter, and a year of hearings. It scales
  // with what is at stake, because so do the objectors.
  const baseCost = Math.max(120_000, land * 0.035) * s.econ.costIdx;
  // Bigger asks draw more design work, opposition and hearing time, but not
  // linearly: the same survey, counsel and environmental record serve the
  // whole application. The old +34% request is the pivot and prices exactly as
  // before.
  const scale = Math.sqrt(askShare / 0.34);
  // Prior relief is allowed — the board can bend again — but each FAR already
  // won makes the next hearing harder and more expensive. There is no absolute
  // city ceiling on the envelope since 2026-10-12 (value.ts resolveRec, NO
  // CEILING ON THE ENVELOPE): one application may ask up to three times the
  // current envelope (maxTarget; current already includes past variances), and
  // this decay is what stops a patient refile loop — without it one once
  // walked a parcel past forty.
  const already = s.variance?.[bbl] ?? 0;
  const priorCost = already > 0 ? 1.35 + 0.12 * already : 1;
  const priorOdds = already > 0 ? Math.exp(-0.55 * already) : 1;
  const cost = Math.round(baseCost * scale * priorCost);
  const months = Math.round(9 + 6 * scale + (already > 0 ? 3 : 0));
  const grant = +(target - current).toFixed(2);
  // A site the neighbourhood already accepts as dense is an easier hearing
  // than one on a quiet street.
  const dense = clamp(demandLinear(rec.demandScore) / 130, 0.1, 0.75);
  const ordinaryOdds = clamp(0.30 + dense, 0.08, 0.82);
  // Asking beyond the old one-third request is possible, not free. Opposition
  // compounds with the magnitude of relief; a 2× envelope has roughly half
  // the ordinary odds and a 3× ask is a genuine long shot.
  const odds = clamp(
    ordinaryOdds * Math.exp(-1.1 * Math.max(0, askShare - 0.34)) * priorOdds,
    0.02, 0.82,
  );
  return { cost, months, grant, targetFar: +target.toFixed(2), currentFar: current, odds, minFar: minTarget, maxFar: maxTarget };
}

/**
 * WHETHER A GRANT WOULD CHANGE WHAT ANYONE BUILDS HERE (playtest F17,
 * 2026-11-27). The desk offered a variance on every owned lot, including a
 * building using 18% of a 31-FAR envelope whose builder's residual was the same
 * $24/sf of lot at three times that envelope, against $1,012/sf of lot for
 * what stands (seed 12007, month 0, 1 Concord Ave) — a fee for an entitlement
 * nobody would use. At month 0 no lot of that seed gains from one at 1.5x or
 * 3x (0 of 400 built, 0 of 417 vacant): the best schemes are held to a few
 * storeys by the skyline (value.ts residualCore, heightCapFloors) far under
 * envelopes of 2-37 FAR. Where the envelope does bind, it says so.
 * This is a read, not a rule: the player may still file.
 *
 * A grant adds something TODAY only if, at the envelope asked for, a builder
 * would pay more for the site than it is worth now — as dirt (the builder's
 * residual at the envelope it has) or with what stands on it (the appraisal
 * per foot of lot, the same comparison the property file's rebuild card makes,
 * ParcelDesk). No threshold. The builder's residual, not the reconciled land
 * price: the price also weighs comps and the opening seed per unit of usable
 * envelope, so it is not a read of what the extra FAR would let someone build.
 */
export function varianceUse(s: GameState, parcels: ParcelTable, bbl: string, targetFar?: number) {
  const q = varianceQuote(s, parcels, bbl, targetFar);
  const rec = resolveRec(parcels, s, bbl);
  if (!q || !rec) return null;
  // the same additive grant resolveRec applies once it is won (s.variance)
  const recAt = { ...rec, farMaxComm: +(rec.farMaxComm + q.grant).toFixed(2), farMaxRes: +(rec.farMaxRes + q.grant).toFixed(2) };
  const usable = (r: typeof rec) => envelopeRealisation(r) * Math.max(r.farMaxComm, r.farMaxRes);
  const dirt = rec.class === "land" || !rec.bldgArea;
  const residualNowPsf = landRead(rec, s.econ).builder;
  const residualAtPsf = landReadAsIf(recAt, s.econ).builder;
  const standingPsf = dirt ? 0
    : marketAppraisal(s, rec, bbl, s.holdings[bbl]?.condition ?? initialCondition(rec)) / Math.max(1, rec.lotArea);
  return {
    builtFar: rec.lotArea > 0 ? rec.bldgArea / rec.lotArea : 0,
    usableNow: usable(rec), usableAt: usable(recAt),
    residualNowPsf, residualAtPsf, standingPsf, dirt,
    adds: residualAtPsf > Math.max(residualNowPsf, standingPsf),
  };
}

export function fileVariance(
  s: GameState, parcels: ParcelTable, bbl: string, targetFar?: number,
): { s: GameState; err?: string; msg?: string } {
  if (!s.holdings[bbl]) return { s, err: "You must own it to apply." };
  if (pendingVariances(s)[bbl]) return { s, err: "Application already pending for this site." };
  if (s.landmarks?.[bbl] !== undefined) return { s, err: "Landmarked; the envelope cannot change." };
  const q = varianceQuote(s, parcels, bbl, targetFar);
  if (!q) {
    // "NOTHING TO APPLY FOR HERE" WAS SEVERAL ANSWERS WEARING ONE SENTENCE.
    // varianceQuote returns null for an unknown parcel, a lot with no area, a
    // landmark, or a site already at the city FAR ceiling — and a refusal that
    // does not name its reason looks like a broken button.
    const rec = resolveRec(parcels, s, bbl);
    if (!rec) return { s, err: "There is no parcel there to apply about." };
    if (!rec.lotArea) {
      return {
        s,
        err: s.merged?.[bbl]
          ? `${rec.address} is part of an assemblage — its land has moved into the site it was folded into. `
            + "Apply on the parent lot, which is the one the board thinks exists."
          : `${rec.address} has no lot area on record, so there is no site to grant relief on. `
            + "That is a fault rather than a rule — please report the address.",
      };
    }
    return { s, err: "Nothing to apply for here." };
  }
  // Land-use counsel, the expediter and the hearing calendar are pre-development
  // spend on dirt you already own, and every sponsor funds that out of the
  // corporate line while the entitlement runs. The odds, the months and the
  // fee are unchanged — this only stops the filing deadline being missed for
  // want of cash on hand, and the draw accrues at index+400 the whole wait.
  const room = spendable(s, parcels);
  if (room.total < q.cost) {
    return {
      s,
      err: `Application fees ${money(q.cost)}; available `
        + `${money(room.total)} (${money(room.cash)} cash, `
        + `${money(room.line)} on the line).`,
    };
  }
  const next: GameState = cloneState(s);
  fundAndBook(next, parcels, q.cost, "dev", { bbl });
  next.varianceApps = {
    ...pendingVariances(next),
    [bbl]: { bbl, filedM: next.month, decideM: next.month + q.months, cost: q.cost, grant: q.grant, odds: q.odds },
  };
  delete next.varianceApp;
  const rec = resolveRec(parcels, next, bbl);
  next.news.unshift({
    q: next.month, kind: "info",
    text: `Application filed at ${rec?.address ?? bbl}: ${q.grant.toFixed(1)} FAR over the district maximum. `
      + `The board sits ${monthLabel(next.month + q.months)} and they say yes about ${(q.odds * 100).toFixed(0)}% of the time.`,
  });
  return { s: next, msg: "Filed." };
}

function decideVariance(s: GameState, parcels: ParcelTable) {
  const apps = pendingVariances(s);
  if (!Object.keys(apps).length) return;
  // Migrate the old singular field even when none of the hearings is due yet.
  s.varianceApps = { ...apps };
  delete s.varianceApp;
  const due = Object.values(apps)
    .filter((app) => s.month >= app.decideM)
    .sort((a, b) => a.decideM - b.decideM || a.bbl.localeCompare(b.bbl));
  for (const app of due) {
    const rec = resolveRec(parcels, s, app.bbl);
    delete s.varianceApps[app.bbl];
    if (!s.holdings[app.bbl]) continue;      // sold it while they deliberated
    const granted = rng(s) < app.odds;
  // THE DECISION IS A FACT ABOUT THE SITE. Recorded on the parcel, not just
  // announced once and scrolled away — a refusal sits over a property for
  // years and everybody in the neighbourhood knows about it.
    if (!s.varianceLog) s.varianceLog = {};
    s.varianceLog[app.bbl] = { m: s.month, granted, far: app.grant, cost: app.cost };
    recordPropertyEvent(s, app.bbl, {
      kind: "planning",
      amount: app.cost,
      outcome: granted
        ? `Variance granted: +${app.grant.toFixed(1)} FAR`
        : `Variance refused: +${app.grant.toFixed(1)} FAR requested`,
    });
    if (granted) {
      if (!s.variance) s.variance = {};
      s.variance[app.bbl] = +((s.variance[app.bbl] ?? 0) + app.grant).toFixed(2);
      // (No land multiplier. This multiplied the lot's land by 1.22, capped at
      // x4, on top of the bigger envelope — which `resolveBase` already hands
      // the residual and the comps desk prices per foot of: the same grant
      // counted twice. The residual on the larger envelope is the value.)
      s.news.unshift({
        q: s.month, kind: "deal",
        text: `The board approved the variance at ${rec?.address ?? app.bbl}. `
          + `+${app.grant.toFixed(1)} FAR; land value reprices.`,
      });
    } else {
      s.news.unshift({
        q: s.month, kind: "warn",
        text: `The board refused the variance at ${rec?.address ?? app.bbl}. Fees lost; envelope unchanged.`,
      });
    }
  }
}

// ----------------------------------------------------------------- landmarks

/**
 * The city designates a building, and it is not a gift.
 *
 * You lose the redevelopment option permanently — no demolition, no bigger
 * building on that site, ever. What you get is a building people care about,
 * which lets a little better than the market and holds its tenants. Whether
 * that trade is good depends entirely on whether the site was worth more than
 * the building, which is the same question every preservation fight is about.
 */
/**
 * How often the commission designates: about one building in fourteen years
 * here [K: judgement — the old monthly 0.6%]. Designations are a flow, so the
 * commission sits on that schedule (each seed at its own hashed phase in the
 * count) rather than on a die each month (2026-11-11).
 */
const LANDMARK_RATE = 0.006;
function tickLandmarks(s: GameState, parcels: ParcelTable, bbls: string[]) {
  const x = s.month * LANDMARK_RATE + hash01(`${s.seed}:landmark`);
  if (Math.floor(x + LANDMARK_RATE) === Math.floor(x)) return;
  // old, characterful, and somewhere that has become worth caring about
  const cands = bbls.filter((b) => {
    if (s.landmarks?.[b] !== undefined || s.developments[b]) return false;
    const rec = resolveRec(parcels, s, b);
    return !!rec && rec.class !== "land" && rec.bldgArea > 0
      && rec.yearBuilt > 0 && rec.yearBuilt < 1940 && demandLinear(rec.demandScore) > 45;
  });
  if (!cands.length) return;
  // the case the preservationists make first: the oldest, then the most cared-about street
  const age = (b: string) => resolveRec(parcels, s, b)!;
  const bbl = cands.slice().sort((a, b) => age(a).yearBuilt - age(b).yearBuilt
    || demandLinear(age(b).demandScore) - demandLinear(age(a).demandScore) || a.localeCompare(b))[0];
  const rec = resolveRec(parcels, s, bbl)!;
  if (!s.landmarks) s.landmarks = {};
  s.landmarks[bbl] = s.month;
  const mine = !!s.holdings[bbl];
  if (mine) s.holdings[bbl].landmarked = true;
  s.news.unshift({
    q: s.month, kind: mine ? "warn" : "info",
    text: `${rec.address} has been landmarked${mine ? " — one of yours" : ""}. `
      + `No demolition or enlargement allowed. `
      + `Leases slightly above market from now on.`,
  });
}

export function tickPlanning(s: GameState, parcels: ParcelTable, bbls: string[]) {
  decideVariance(s, parcels);
  tickZoning(s, parcels, bbls);
  tickLandmarks(s, parcels, bbls);
}
