// ZONING IS NOT A CONSTANT.
//
// `farMaxComm` and `farMaxRes` were stamped on at generation and never moved
// again, for a hundred years, in a city that grew from half-empty to built
// out. That is the least realistic thing left in the model: a rezoning is the
// largest single value event that can happen to a piece of dirt — larger than
// any building you would put on it — and there was no such thing.
//
// Three mechanisms, and they are deliberately different in who drives them:
//
//   REZONING   — the CITY acts, on districts, over years. Places that have
//                filled up and got expensive get upzoned; places that have
//                emptied out or fought hard get held down. You do not control
//                it, you read it, and if you own the dirt when it lands you
//                did very well without doing anything.
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
import type { GameState } from "./types";
import { logBooks, monthLabel } from "./types";
import { rng, rrange } from "./market";
import { resolveRec, landValue } from "./value";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** How far a district's envelope can be moved, either way, over a century. */
// A district can be held down but not gutted: repeated downzonings were
// taking whole neighbourhoods to 57% of their original envelope, which is not
// planning, it is demolition by paperwork.
const FAR_FLOOR = 0.72;
const FAR_CEIL = 2.6;

// ------------------------------------------------------------------ rezoning

/**
 * The city looks at a district and decides what it should be allowed to
 * become. It reads the same things a planning department reads: how much of
 * the district is actually built out against what it is permitted, and whether
 * the place has become somewhere people want to be.
 */
export function tickZoning(s: GameState, parcels: ParcelTable, bbls: string[]) {
  if (!s.zoneAdj) s.zoneAdj = {};
  // A rezoning is a multi-year political process. Roughly one district moves
  // every four or five years across the whole town.
  if (rng(s) > 0.019) return;

  // gather districts and how they are doing
  const byDist = new Map<string, { built: number; envelope: number; demand: number; n: number }>();
  for (const bbl of bbls) {
    const rec = parcels[bbl];
    if (!rec || !rec.lotArea) continue;
    const live = resolveRec(parcels, s, bbl);
    if (!live) continue;
    const d = rec.district || "—";
    const e = byDist.get(d) ?? { built: 0, envelope: 0, demand: 0, n: 0 };
    e.built += live.bldgArea;
    e.envelope += live.lotArea * Math.max(live.farMaxComm, live.farMaxRes, 2);
    e.demand += live.demandScore;
    e.n++;
    byDist.set(d, e);
  }
  const rows = [...byDist.entries()].filter(([, v]) => v.n >= 20);
  if (!rows.length) return;

  const pick = rows[Math.floor(rng(s) * rows.length)];
  const [dist, v] = pick;
  const usedUp = v.envelope > 0 ? v.built / v.envelope : 0;
  const demand = v.demand / v.n;
  const cur = s.zoneAdj[dist] ?? 1;

  // A district that has built out its envelope and is somewhere people want to
  // be gets more envelope. One that is half empty does not need any, and a
  // place going backwards gets held down.
  // CITIES DENSIFY. Over a century upzonings comfortably outnumber
  // downzonings — a growing town keeps finding it needs more room, and the
  // downzonings are the exceptions that make the news. The first cut of this
  // read `usedUp` straight and biased hard the other way, because a third of
  // every district is vacant lots and the ratio is structurally low: nine
  // districts were downzoned for every three upzoned across three centuries.
  const up = clamp(0.42 + usedUp * 0.7 + (demand - 50) / 120, 0.12, 0.95);
  const isUp = rng(s) < up;
  const step = isUp ? rrange(s, 1.12, 1.45) : rrange(s, 0.86, 0.96);
  const next = clamp(cur * step, FAR_FLOOR, FAR_CEIL);
  if (Math.abs(next - cur) < 0.02) return;
  s.zoneAdj[dist] = +next.toFixed(3);

  // Land reprices the day it passes, because the envelope IS the land value.
  for (const bbl of bbls) {
    if (parcels[bbl]?.district !== dist) continue;
    s.landAdj[bbl] = Math.min(4, (s.landAdj[bbl] ?? 1) * (isUp ? 1 + (step - 1) * 0.45 : 1 - (1 - step) * 0.4));
  }
  const yours = Object.keys(s.holdings).filter((b) => parcels[b]?.district === dist).length;
  s.news.unshift({
    q: s.month, kind: isUp ? "event" : "warn",
    text: isUp
      ? `${dist} has been upzoned — the envelope goes to ${(next * 100).toFixed(0)}% of what it was at the start. `
        + `Every lot there is worth more this morning than it was last night${yours ? `, and you own ${yours} of them` : ""}.`
      : `${dist} has been downzoned to ${(next * 100).toFixed(0)}% of its original envelope. `
        + `The neighbourhood fought it and won${yours ? `, and you are holding ${yours} lots there` : ""}.`,
  });
}

// ------------------------------------------------------------------ variance

/** What it costs to try, and what the odds actually are. */
export function varianceQuote(s: GameState, parcels: ParcelTable, bbl: string) {
  const rec = resolveRec(parcels, s, bbl);
  if (!rec || !rec.lotArea) return null;
  if (s.landmarks?.[bbl] !== undefined) return null;
  const land = landValue(rec, s.econ);
  // Lawyers, an architect, an expediter, and a year of hearings. It scales
  // with what is at stake, because so do the objectors.
  const cost = Math.round(Math.max(120_000, land * 0.035) * s.econ.costIdx);
  const months = Math.round(rrange(s, 9, 18));
  // ONE EXCEPTION PER LOT. A board that has already granted you relief on this
  // site does not entertain a second application for more of the same, and
  // decaying the odds instead let a patient bot refile its way to forty-one
  // FAR on a single parcel — which the invariant sweep caught immediately.
  if ((s.variance?.[bbl] ?? 0) > 0) return null;
  // The ask: a third more envelope.
  const grant = +(Math.max(rec.farMaxComm, rec.farMaxRes, 2) * 0.34).toFixed(2);
  // A site the neighbourhood already accepts as dense is an easier hearing
  // than one on a quiet street.
  const dense = clamp(rec.demandScore / 130, 0.1, 0.75);
  const odds = clamp(0.30 + dense - (s.econ.phase === "recession" ? 0.08 : 0), 0.08, 0.82);
  return { cost, months, grant, odds };
}

export function fileVariance(
  s: GameState, parcels: ParcelTable, bbl: string,
): { s: GameState; err?: string; msg?: string } {
  if (!s.holdings[bbl]) return { s, err: "You have to own it to ask for anything." };
  if (s.varianceApp) return { s, err: "You already have an application in front of the board. One at a time." };
  if (s.landmarks?.[bbl] !== undefined) return { s, err: "It is landmarked. The envelope is the envelope." };
  if ((s.variance?.[bbl] ?? 0) > 0) return { s, err: "The board has already granted relief on this site. They will not do it twice." };
  const q = varianceQuote(s, parcels, bbl);
  if (!q) return { s, err: "Nothing to apply for here." };
  if (s.cash < q.cost) return { s, err: `The application runs $${(q.cost / 1e6).toFixed(2)}M in fees — you're short.` };
  const next: GameState = JSON.parse(JSON.stringify(s));
  next.cash -= q.cost;
  logBooks(next, "dev", q.cost);
  next.varianceApp = { bbl, filedM: next.month, decideM: next.month + q.months, cost: q.cost, grant: q.grant, odds: q.odds };
  const rec = resolveRec(parcels, next, bbl);
  next.news.unshift({
    q: next.month, kind: "info",
    text: `Application filed at ${rec?.address ?? bbl}: ${q.grant.toFixed(1)} FAR over the district maximum. `
      + `The board sits ${monthLabel(next.month + q.months)} and they say yes about ${(q.odds * 100).toFixed(0)}% of the time.`,
  });
  return { s: next, msg: "Filed." };
}

function decideVariance(s: GameState, parcels: ParcelTable) {
  const app = s.varianceApp;
  if (!app || s.month < app.decideM) return;
  const rec = resolveRec(parcels, s, app.bbl);
  delete s.varianceApp;
  if (!s.holdings[app.bbl]) return;      // sold it while they deliberated
  if (rng(s) < app.odds) {
    if (!s.variance) s.variance = {};
    s.variance[app.bbl] = +((s.variance[app.bbl] ?? 0) + app.grant).toFixed(2);
    s.landAdj[app.bbl] = Math.min(4, (s.landAdj[app.bbl] ?? 1) * 1.22);
    s.news.unshift({
      q: s.month, kind: "deal",
      text: `The board approved the variance at ${rec?.address ?? app.bbl}. `
        + `${app.grant.toFixed(1)} FAR of extra envelope, and the dirt underneath it just repriced.`,
    });
  } else {
    s.news.unshift({
      q: s.month, kind: "warn",
      text: `The board refused the variance at ${rec?.address ?? app.bbl}. The fees are spent and the envelope is what it always was.`,
    });
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
function tickLandmarks(s: GameState, parcels: ParcelTable, bbls: string[]) {
  if (rng(s) > 0.006) return;
  // old, characterful, and somewhere that has become worth caring about
  const cands = bbls.filter((b) => {
    if (s.landmarks?.[b] !== undefined || s.developments[b]) return false;
    const rec = resolveRec(parcels, s, b);
    return !!rec && rec.class !== "land" && rec.bldgArea > 0
      && rec.yearBuilt > 0 && rec.yearBuilt < 1940 && rec.demandScore > 45;
  });
  if (!cands.length) return;
  const bbl = cands[Math.floor(rng(s) * cands.length)];
  const rec = resolveRec(parcels, s, bbl)!;
  if (!s.landmarks) s.landmarks = {};
  s.landmarks[bbl] = s.month;
  const mine = !!s.holdings[bbl];
  if (mine) s.holdings[bbl].landmarked = true;
  s.news.unshift({
    q: s.month, kind: mine ? "warn" : "info",
    text: `${rec.address} has been landmarked${mine ? " — one of yours" : ""}. `
      + `Nobody knocks it down now, and nobody builds anything bigger there. `
      + `It will let a little better than the market for the rest of its life, which is the whole of what you get for the site.`,
  });
}

export function tickPlanning(s: GameState, parcels: ParcelTable, bbls: string[]) {
  decideVariance(s, parcels);
  tickZoning(s, parcels, bbls);
  tickLandmarks(s, parcels, bbls);
}
