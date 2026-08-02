// THE OTHER FIRMS ON THE STREET.
//
// Until now the market was a statistical process. Listings appeared from
// nowhere, an anonymous city built itself, and invisible buyers took deals out
// from under you with a line of news that said "another buyer". There was
// nobody to lose a deal TO, nobody whose overreach caused the crash, and
// nobody who wanted your corner because it finished their assemblage.
//
// So: five or six named firms with balance sheets. They own real parcels. They
// work the same tape you do, and their appetite is their dry powder times the
// credit window — which means in a boom you are bidding against people with
// too much money, and in a crunch you are the only bid in the room. They lever
// up when money is cheap because that is what wins in the short run, and the
// ones who levered hardest are the ones whose portfolios hit the tape at
// sixty cents when the window shuts.
//
// What is deliberately NOT modelled: rent rolls, per-asset loans and tenants
// for each firm. A rival carries an aggregate balance sheet and a list of what
// it owns. That is enough to compete, to fail, and to be read — and it keeps
// the save file the size of a save file.
//
// DEVELOPMENT IS MODELLED, because leaving it out made a liar of this file.
// Three of these firms are called developers and the style table said "buys
// dirt and puts buildings on it; the city's growth is partly theirs" — and
// then they only ever bought. Nobody could beat you to a site, no competitor's
// tower ever rose across the street and emptied your building, and no
// half-finished job ever came to market because its sponsor could not roll the
// construction loan, which is the best deal in the business. A developer here
// now claims jobs out of the city's own pipeline: buys the dirt, writes the
// equity, carries the loan through the cycle, and either owns a building at
// the end of it or hands a frame to a receiver.
import type { ParcelRecord, ParcelTable } from "@/data/types";
import type { BuiltClass, Condition, DevUse, GameState, Rival, RivalStyle } from "./types";
import { BUILD_MONTHS, rng, rrange } from "./market";
import { assetValue, initialCondition, landValue, noiAfterTaxYr, occupancy, resolveRec } from "./value";
import { devMix, dominantOf, farMaxFor, HARD_COST_PSF, SOFT_COST, useForZone } from "./dev";
import { recordComp } from "./comps";

// Ashport is an old port town; its money has old-port-town names.
// Everyone starts the century the same size you do — five to fifteen million
// of equity, a couple of buildings, and a hundred years to compound it. The
// firms that end up owning the skyline EARNED it inside the sim, which is the
// only way their success means anything.
// A DOZEN FIRMS, NOT SIX. Six was enough to have somebody to lose a deal to;
// it was not enough for the street to have a texture — for there to be two old
// families who never sell and three levered shops racing each other into the
// same peak. Every one of these starts the century the same size you do, five
// to eighteen million of equity, and compounds it inside the sim. The ones who
// end up owning the skyline earned it here.
const FIRMS: { name: string; style: RivalStyle; equity: number; ltv: number }[] = [
  { name: "Calloway & Reed", style: "family", equity: 11_000_000, ltv: 0.32 },
  { name: "Harbor Point Partners", style: "core", equity: 14_000_000, ltv: 0.52 },
  { name: "Meridian Yield Group", style: "opportunistic", equity: 8_000_000, ltv: 0.71 },
  { name: "Alden Development Co.", style: "developer", equity: 12_000_000, ltv: 0.66 },
  { name: "Wentworth Trust", style: "core", equity: 15_000_000, ltv: 0.41 },
  { name: "Kestrel Capital", style: "opportunistic", equity: 5_000_000, ltv: 0.78 },
  { name: "Thorne & Boyle", style: "family", equity: 9_000_000, ltv: 0.28 },
  { name: "Longwharf Realty", style: "developer", equity: 10_000_000, ltv: 0.69 },
  { name: "Pell Street Holdings", style: "opportunistic", equity: 6_500_000, ltv: 0.82 },
  { name: "Granite Mutual", style: "core", equity: 18_000_000, ltv: 0.44 },
  { name: "Wrenfield Brothers", style: "family", equity: 7_500_000, ltv: 0.35 },
  { name: "Tidewater Development", style: "developer", equity: 8_500_000, ltv: 0.72 },
];

// What each kind of firm is FOR. These are the only behavioural differences,
// and every one of them is a real distinction between real shops.
const STYLE: Record<RivalStyle, {
  appetite: number;       // how often they are in the market at all
  procyclical: number;    // how much the credit window moves that appetite
  maxLtv: number;         // where they stop, or refuse to
  cashOut: number;        // how eagerly they refinance equity out in a boom
  classes: string[] | null;
  patience: number;       // how far above appraisal they will chase a deal
}> = {
  // sold their soul to nobody; buys quality, holds forever, sleeps at night
  family:        { appetite: 0.30, procyclical: 0.5, maxLtv: 0.50, cashOut: 0.00, classes: null, patience: 1.02 },
  // institutional money: steady, disciplined, buys stabilised income
  core:          { appetite: 0.75, procyclical: 1.0, maxLtv: 0.65, cashOut: 0.20, classes: ["office", "multifamily"], patience: 1.06 },
  // the ones who win the last three years of every cycle and lose the next one
  opportunistic: { appetite: 1.25, procyclical: 1.9, maxLtv: 0.88, cashOut: 0.85, classes: null, patience: 1.16 },
  // buys dirt and puts buildings on it; the city's growth is partly theirs
  developer:     { appetite: 0.85, procyclical: 1.5, maxLtv: 0.78, cashOut: 0.55, classes: ["land", "industrial", "retail"], patience: 1.10 },
};

const RATE_SPREAD = 1.9;   // what a firm of this size pays over the index

// ---------------------------------------------------------------- building
//
// How much of the city's own pipeline each kind of firm is willing to own.
// A developer is in the business; an opportunistic shop builds when the money
// is free and regrets it; core and family capital does not take construction
// risk, because that is the entire point of core and family capital.
const BUILD_APPETITE: Record<RivalStyle, number> = {
  developer: 1, opportunistic: 0.3, core: 0.06, family: 0,
};
const CONSTR_SPREAD_R = 2.6;   // construction paper is dearer than term paper

/**
 * ONE DEED, ONE OWNER.
 *
 * Every path that hands a parcel to a firm goes through here, because the ones
 * that did not each grew their own way of putting the same building on two
 * balance sheets — a receiver still listing a site the buyer had already
 * taken, a rescued frame added to the taker while the dead sponsor kept it.
 * Strip it from whoever has it, pay them if there is a price, then record it.
 */
function transferDeed(s: GameState, bbl: string, to: Rival, price: number) {
  for (const r of s.rivals ?? []) {
    if (r === to || !r.bbls.includes(bbl)) continue;
    r.bbls = r.bbls.filter((b) => b !== bbl);
    if (price > 0) {
      const relief = Math.min(r.debt, Math.round(price * r.targetLtv));
      r.debt -= relief;
      r.cash += price - relief;
    }
  }
  if (!to.bbls.includes(bbl)) to.bbls.push(bbl);
}

/** The all-in budget a firm underwrites for a job, on the same basis the player does. */
function jobBudget(s: GameState, use: DevUse, sf: number, floors: number): number {
  const mix = devMix(use);
  let psf = 0, w = 0;
  for (const u of Object.keys(mix) as BuiltClass[]) { const sh = mix[u] ?? 0; psf += HARD_COST_PSF[u] * sh; w += sh; }
  psf = w > 0 ? psf / w : HARD_COST_PSF.office;
  const heightPrem = floors > 30 ? 1.28 : floors > 18 ? 1.18 : floors > 8 ? 1.07 : 1;
  const hard = sf * psf * s.econ.costIdx * heightPrem * 1.04;
  return Math.round(hard * (1 + SOFT_COST) * 1.06);
}

/**
 * SOMEBODY ON THE STREET TAKES THE SITE.
 *
 * Called from the city's growth loop the moment a job is conceived. A firm
 * with the appetite, the dry powder and a reason to like the corner buys the
 * dirt and puts its name on the job; if nobody bites, the anonymous city
 * builds it exactly as before. That is the honest split — most construction in
 * any city is done by people you have never heard of, and the rest is done by
 * the four names you compete with every month.
 *
 * Returns the claiming firm, or null.
 */
export function claimJob(
  s: GameState, parcels: ParcelTable, bbl: string,
  use: DevUse, sf: number, floors: number, deliverM: number,
): Rival | null {
  const rec = resolveRec(parcels, s, bbl);
  if (!rec) return null;
  const ci = Math.max(0.4, Math.min(1.25, s.econ.creditIdx ?? 1));
  // Construction debt is the first thing to disappear when the window shuts.
  const phaseMult = s.econ.phase === "peak" ? 1.5 : s.econ.phase === "expansion" ? 1.2
    : s.econ.phase === "recovery" ? 0.6 : 0.15;
  const cost = jobBudget(s, use, sf, floors);
  const land = Math.round(landValue(rec, s.econ) * rrange(s, 1.02, 1.18));
  const ltc = Math.max(0.4, Math.min(0.7, 0.7 * ci));
  const equity = Math.round(cost * (1 - ltc)) + land;

  const runners = livingRivals(s).filter((r) => {
    const want = BUILD_APPETITE[r.style];
    if (want <= 0) return false;
    // one job at a time for most, two for a firm that does nothing else
    const live = (s.cityJobs ?? []).filter((j) => j.firmId === r.id).length;
    if (live >= (r.style === "developer" ? 2 : 1)) return false;
    // A JOB HAS TO FIT THE FIRM. Nobody with twelve million of equity starts a
    // sixty-million-dollar tower, and a shop that does it anyway is not a
    // developer, it is a casualty.
    if (cost > (r.aum ?? 0) * 0.75 + r.cash * 4) return false;
    // The equity goes in over the build, not on day one — the site and the
    // first year of it is what has to be in the bank to break ground. That is
    // the actual test a developer applies, and requiring the whole cheque up
    // front meant one job got started in fifty years.
    const dayOne = land + Math.round(cost * (1 - ltc) * 0.45);
    if (r.cash < dayOne + Math.max(1_000_000, r.cash * 0.06)) return false;
    return rng(s) < 0.5 * want * phaseMult * ci;
  });
  if (!runners.length) return null;

  // the hungriest of the firms that can actually fund it
  let best = runners[0], bestW = -Infinity;
  for (const r of runners) {
    const w = BUILD_APPETITE[r.style] * (r.cash / Math.max(1, equity)) * (0.6 + rng(s) * 0.8);
    if (w > bestW) { bestW = w; best = r; }
  }

  best.cash -= land;
  best.basis = Math.round((best.basis ?? 0) + land);
  transferDeed(s, bbl, best, land);
  const job = (s.cityJobs ?? []).find((j) => j.bbl === bbl);
  if (job) {
    job.firmId = best.id;
    job.cost = cost;
    job.spent = 0;
    job.equityLeft = Math.round(cost * (1 - ltc));
    job.debt = 0;
    job.ratePct = +(s.econ.indexRate + CONSTR_SPREAD_R).toFixed(2);
  }
  s.news.unshift({
    q: s.month, kind: "event",
    text: `${best.name} has broken ground at ${rec.address} — ${(sf / 1000).toFixed(0)}k sf of ${use}, `
      + `$${(cost / 1e6).toFixed(1)}M, due ${2000 + Math.floor(deliverM / 12)}. That space is coming whether you want it or not.`,
  });
  return best;
}

/**
 * The money going into every job the street has under way: equity first, then
 * the bank, interest capitalised into the balance. It is on their balance
 * sheet from the day the hole is dug, which is why a firm that started three
 * towers at the peak is carrying three towers' worth of debt against three
 * pieces of dirt when the market turns.
 */
function fundJobs(s: GameState) {
  for (const j of s.cityJobs ?? []) {
    if (!j.firmId || j.orphaned) continue;
    const r = s.rivals.find((x) => x.id === j.firmId);
    if (!r || r.failedM !== undefined) { j.orphaned = true; continue; }
    const span = Math.max(1, j.deliverM - j.startM);
    const t1 = Math.min(1, (s.month - j.startM + 1) / span);
    const t0 = Math.min(1, (s.month - j.startM) / span);
    const curve = (t: number) => t * t * (3 - 2 * t);
    const spend = Math.round((j.cost ?? 0) * Math.max(0, curve(t1) - curve(t0)));
    if (spend > 0) {
      const fromEquity = Math.min(spend, Math.max(0, j.equityLeft ?? 0));
      r.cash -= fromEquity;
      j.equityLeft = Math.max(0, (j.equityLeft ?? 0) - fromEquity);
      const fromDebt = spend - fromEquity;
      j.debt = (j.debt ?? 0) + fromDebt;
      r.debt += fromDebt;
      j.spent = (j.spent ?? 0) + spend;
    }
    // capitalised, the way construction interest actually works
    const cap = Math.round(((j.debt ?? 0) * (j.ratePct ?? 8)) / 100 / 12);
    if (cap > 0) { j.debt = (j.debt ?? 0) + cap; r.debt += cap; }
  }
}

/**
 * The building opens and it is theirs. Called from the city's delivery loop so
 * there is exactly one place in the codebase where a building comes into
 * existence and exactly one place where its square feet enter the market.
 */
export function jobDelivered(s: GameState, parcels: ParcelTable, bbl: string, firmId: string, cost: number) {
  const r = s.rivals.find((x) => x.id === firmId);
  if (!r) return;
  transferDeed(s, bbl, r, 0);
  r.basis = Math.round((r.basis ?? 0) + cost);
  const rec = resolveRec(parcels, s, bbl);
  if (rec && rng(s) < 0.7) {
    s.news.unshift({
      q: s.month, kind: "event",
      text: `${r.name} has opened ${rec.address}. It is empty today and it is competing with you tomorrow.`,
    });
  }
}

/**
 * THE FRAME NOBODY OWNS.
 *
 * A sponsor that dies mid-job leaves a part-built building standing on a site
 * the receiver has to clear. It goes to the tape at the land value plus a
 * fraction of what has been sunk — never all of it, because a stranger's
 * half-finished building is worth less than the money that went into it, and
 * because whoever buys it inherits a design they did not draw. This is the
 * best deal in development and the game could not previously produce one.
 */
function orphanToTape(s: GameState, parcels: ParcelTable) {
  for (const j of s.cityJobs ?? []) {
    if (!j.orphaned) continue;
    // A frame that did not sell goes back on the tape, cheaper. Standing steel
    // rusts and a stalled site is a story everybody in town knows — leaving it
    // listed once and then forever invisible meant an unsold frame simply
    // haunted the map for the rest of the century.
    if (j.listedM !== undefined && s.month - j.listedM < 24) continue;
    const rec = resolveRec(parcels, s, j.bbl);
    if (!rec || s.holdings[j.bbl] || s.listings.some((l) => l.bbl === j.bbl)) continue;
    const sunk = j.spent ?? 0;
    const progress = Math.min(0.95, sunk / Math.max(1, j.cost ?? 1));
    const stale = Math.max(0.45, 1 - (j.listedM === undefined ? 0 : (s.month - j.listedM) / 90));
    const ask = Math.round((landValue(rec, s.econ) + sunk * rrange(s, 0.45, 0.7) * stale) / 1000) * 1000;
    if (ask <= 0) continue;
    const relist = j.listedM !== undefined;
    j.listedM = s.month;
    s.listings.push({
      bbl: j.bbl, ask, listedM: s.month, expiresM: s.month + Math.round(rrange(s, 8, 16)), distress: true,
      halfBuilt: { use: j.use, sf: j.sf, floors: j.floors, progress, costToComplete: Math.max(0, (j.cost ?? 0) - sunk) },
    });
    s.news.unshift({
      q: s.month, kind: "event",
      text: relist
        ? `The stalled frame at ${rec.address} is back on the tape at $${(ask / 1e6).toFixed(2)}M. Nobody wanted it last time and the steel has not got any newer.`
        : `The receiver is clearing a half-finished building at ${rec.address} — ${(progress * 100).toFixed(0)}% complete, `
          + `$${(ask / 1e6).toFixed(2)}M for the site and the frame. Somebody else's problem is on the market.`,
    });
  }
}

export function initRivals(s: GameState, parcels: ParcelTable, bbls: string[]): Rival[] {
  const out: Rival[] = [];
  // The built stock that isn't yours has to belong to SOMEBODY. Handing a
  // slice of it to named firms costs nothing on the map and means the town has
  // owners you can go and talk to.
  const built = bbls.filter((b) => {
    const r = parcels[b];
    return r && r.class !== "land" && r.bldgArea > 0;
  });
  const taken = new Set<string>();
  FIRMS.forEach((f, i) => {
    const r: Rival = {
      id: `r${i}`, name: f.name, style: f.style,
      // The reserve comes OUT of what they raised, it is not conjured on top
      // of it. A firm holding back a tenth of its fund has a tenth less to buy
      // with, exactly like you do.
      cash: 0, bbls: [], debt: 0, targetLtv: f.ltv, bornM: 0, basis: 0,
    };
    const reserveShare = rrange(s, 0.06, 0.16);
    r.cash = Math.round(f.equity * reserveShare);
    // buy until the deployable equity is spent
    let spend = f.equity - r.cash;
    let guard = 0;
    while (spend > 0 && guard++ < 3000) {
      const bbl = built[Math.floor(rng(s) * built.length)];
      if (!bbl || taken.has(bbl)) continue;
      const rec = parcels[bbl];
      const v = assetValue(rec, s.econ, initialCondition(rec));
      if (v <= 0) continue;
      const styleOk = STYLE[f.style].classes === null || STYLE[f.style].classes!.includes(rec.class);
      if (!styleOk && rng(s) < 0.75) continue;
      const equityIn = v * (1 - f.ltv);
      if (equityIn > spend) { if (spend < f.equity * 0.08) break; else continue; }
      taken.add(bbl);
      r.bbls.push(bbl);
      r.debt += Math.round(v * f.ltv);
      r.basis = Math.round((r.basis ?? 0) + v);
      spend -= equityIn;
    }
    out.push(r);
  });
  return out;
}

/** How a firm's stewardship reads, in words, for the balance sheet. */
export function rivalCondition(r: Rival): Condition {
  const c = r.condIdx ?? 0.8;
  return c > 0.78 ? "good" : c > 0.52 ? "standard" : "worn";
}

const GRADES: Condition[] = ["worn", "standard", "good"];

/**
 * WHAT A FIRM'S CARE DOES TO A BUILDING IT OWNS — which is move it a notch,
 * not replace its history.
 *
 * Reading a firm's stewardship as the building's condition outright meant a
 * disciplined core fund's 1904 warehouse appraised as new construction: twenty
 * per cent more rent and twenty per cent more value on every asset the moment
 * the firm bought it, which made well-run money unbeatable at the bid. A good
 * operator lifts a tired building one grade. A bad one runs a good building
 * down one. Neither of them changes when it was built.
 */
function assetGrade(r: Rival, rec: ParcelRecord): Condition {
  const base = initialCondition(rec);
  const c = r.condIdx ?? 0.8;
  const notch = c > 0.82 ? 1 : c > 0.5 ? 0 : -1;
  const i = Math.max(0, Math.min(2, GRADES.indexOf(base) + notch));
  return GRADES[i];
}

/**
 * Gross asset value, annual NOI and leverage, marked today — through the
 * firm's own occupancy and the state of its buildings.
 *
 * Occupancy scales income one-for-one and value rather less, because a buyer
 * pays for the stabilised story as well as the rent that is arriving. That
 * split is the whole reason a half-empty building is worth more than half a
 * full one, and why a firm can be losing money and still look solvent for a
 * while — right up until the lender marks it.
 */
export function markRival(s: GameState, parcels: ParcelTable, r: Rival): { aum: number; noiYr: number; ltv: number } {
  let aum = 0, noi = 0;
  const bookMkt = Math.max(0.35, r.mktOcc ?? 0.88);
  for (const bbl of r.bbls) {
    const rec = resolveRec(parcels, s, bbl);
    if (!rec) continue;
    const cond = assetGrade(r, rec);
    const v = assetValue(rec, s.econ, cond);
    if (rec.class === "land" || !rec.bldgArea) { aum += v; noi += noiAfterTaxYr(rec, s.econ, cond, v); continue; }
    // Against the book's OWN market occupancy, not this building's. `r.occ`
    // is a portfolio average; dividing it by an individual building's
    // occupancy handed a firm a 35% uplift on every troubled asset it owned —
    // exactly the assets that should be dragging the mark down.
    const ratio = Math.max(0.35, Math.min(1.2, (r.occ ?? bookMkt) / bookMkt));
    aum += v * (0.42 + 0.58 * ratio);
    noi += noiAfterTaxYr(rec, s.econ, cond, v) * ratio;
  }
  return { aum, noiYr: noi, ltv: aum > 0 ? r.debt / aum : r.debt > 0 ? 9 : 0 };
}

// How hard each kind of firm works its buildings. An institution runs a
// leasing team and a capital plan; a levered opportunistic shop defers the
// roof because the roof is not in this year's model.
const CARE: Record<RivalStyle, { lease: number; capex: number }> = {
  family:        { lease: 0.9,  capex: 1.15 },
  core:          { lease: 1.15, capex: 1.2 },
  opportunistic: { lease: 0.85, capex: 0.45 },
  developer:     { lease: 1.0,  capex: 0.8 },
};

/**
 * A YEAR IN THE LIFE OF A PORTFOLIO.
 *
 * Occupancy walks toward what the market is doing, but never arrives cleanly:
 * a firm can lose an anchor in a good year or fill a building in a bad one.
 * Condition decays every month and only stops decaying if somebody writes a
 * cheque — which is a real decision with a real cost, and the firms that skip
 * it are marked down for it exactly the way the player is.
 */
function tickAssetManagement(s: GameState, parcels: ParcelTable, r: Rival) {
  if (!r.bbls.length) { r.occ = undefined; return; }
  const care = CARE[r.style];
  // where the market says their book should sit
  let target = 0, n = 0;
  for (const bbl of r.bbls) {
    const rec = resolveRec(parcels, s, bbl);
    if (!rec || rec.class === "land" || !rec.bldgArea) continue;
    target += occupancy(rec, s.econ); n++;
  }
  if (!n) { r.occ = undefined; return; }
  r.mktOcc = target / n;
  target = r.mktOcc * (0.965 + 0.05 * care.lease);
  if (r.occ === undefined) r.occ = target;
  r.occ += (target - r.occ) * 0.055 + rrange(s, -0.004, 0.004);
  // AN ANCHOR WALKS. Rare, expensive, and the reason a portfolio occupancy is
  // a story rather than a number that tracks the index.
  if (rng(s) < 0.006 / Math.max(1, Math.sqrt(r.bbls.length) / 2)) {
    r.occ -= rrange(s, 0.05, 0.14);
    if (rng(s) < 0.35) {
      s.news.unshift({
        q: s.month, kind: "event",
        text: `${r.name} has lost a major tenant. Their book is running at ${(Math.max(0, r.occ) * 100).toFixed(0)}% — somebody in this town is about to have space to fill.`,
      });
    }
  }
  r.occ = Math.max(0.2, Math.min(0.99, r.occ));

  // the bricks
  if (r.condIdx === undefined) r.condIdx = 0.72;
  // Buildings age faster than anyone budgets for, which is why 'well kept'
  // tops out just short of new rather than at it.
  r.condIdx -= 0.0024 * (s.econ.phase === "recession" ? 1.25 : 1);
  const aum = r.aum ?? 0;
  // a capital plan is roughly 30bps of gross assets a year, and it is the
  // first line cut when a firm is short
  const want = Math.round((0.003 * aum * care.capex) / 12);
  if (want > 0 && r.cash > want * 6 && !r.stressMs) {
    r.cash -= want;
    r.capexYr = (r.capexYr ?? 0) + want;
    r.condIdx += 0.0026 * care.capex;
  }
  r.condIdx = Math.max(0.3, Math.min(0.97, r.condIdx));
  if (s.month % 12 === 0) r.capexYr = 0;
}

/** Firms still standing. */
export function livingRivals(s: GameState): Rival[] {
  return (s.rivals ?? []).filter((r) => r.failedM === undefined);
}

/**
 * How much competing money is in the room for a deal today.
 *
 * 1 is a normal market. Above 1 you are bidding against people with more dry
 * powder than ideas; below 1 the phone has stopped ringing for everyone and a
 * disciplined buyer gets to name their price. This is the number that makes
 * waiting for the bottom a skill rather than a formality.
 */
export function marketAppetite(s: GameState): number {
  const ci = Math.max(0.4, Math.min(1.25, s.econ.creditIdx ?? 1));
  let a = 0, n = 0;
  for (const r of livingRivals(s)) {
    const st = STYLE[r.style];
    // a firm with no dry powder is not a bidder, however loudly it talks
    const dry = Math.max(0, Math.min(1.5, r.cash / Math.max(1, 0.04 * Math.max(1, r.aum ?? r.debt))));
    a += st.appetite * (1 + st.procyclical * (ci - 1)) * Math.min(1.15, 0.2 + dry);
    n++;
  }
  if (!n) return Math.max(0.25, ci);
  // normalised so a full street at a normal credit window reads 1.0 — the
  // number is meant to be compared to one, not to itself
  return Math.max(0.2, a / n / NEUTRAL_APPETITE);
}

// The reference a healthy street reads against, measured from play rather
// than derived: six firms at a normal credit window with normal dry powder.
// Getting this wrong is not cosmetic — appetite scales how fast listings are
// absorbed, and a number that sits below one all century means every building
// lingers on the tape and stale-reprices downward, which is a standing gift to
// whoever buys the most. It cost the audit its entire risk frontier once.
const NEUTRAL_APPETITE = 0.43;

/** The firm that owns this parcel, if any. */
export function ownerOf(s: GameState, bbl: string): Rival | null {
  for (const r of s.rivals ?? []) if (r.bbls.includes(bbl)) return r;
  return null;
}

/**
 * One month of the competition.
 *
 * Order matters and mirrors the real thing: mark the book, service the debt,
 * then decide whether you are a buyer or a seller — and if the answer is
 * neither because the bank is calling, you are a forced seller and the whole
 * market finds out.
 */
// Money that comes back. A firm that fails is replaced, because the buildings
// are still there and somebody always raises a fund to buy them — a city that
// loses three shops over a century and never gains one is not a city, it is a
// slow liquidation.
const NEW_FIRMS: { name: string; style: RivalStyle }[] = [
  { name: "Northgate Partners", style: "opportunistic" },
  { name: "Sable & Hale", style: "core" },
  { name: "Drydock Holdings", style: "developer" },
  { name: "Ostrander Group", style: "opportunistic" },
  { name: "Bellweather Estates", style: "family" },
  { name: "Quarry Lane Capital", style: "core" },
  { name: "Alden Municipal Pension", style: "core" },
  { name: "Fen & Marrow", style: "opportunistic" },
  { name: "Corbin Whitlock", style: "opportunistic" },
  { name: "Saltmarsh Trust", style: "family" },
  { name: "Ironbound Development", style: "developer" },
  { name: "Halyard Investors", style: "core" },
  { name: "Verity Street Capital", style: "opportunistic" },
  { name: "Merrow & Sons", style: "family" },
  { name: "Pilotage Partners", style: "developer" },
  { name: "Consolidated Wharf Co.", style: "core" },
];
// The street refills toward a dozen, not toward four. A market with four firms
// left in it is a market where nothing is contested.
const MIN_FIRMS = 9;

function maybeNewFirm(s: GameState, ci: number) {
  const living = livingRivals(s);
  if (living.length >= MIN_FIRMS) return;
  // capital returns when the window is open, not while it is shut
  if (ci < 0.88 || rng(s) > 0.045) return;
  const used = new Set((s.rivals ?? []).map((r) => r.name));
  const pool = NEW_FIRMS.filter((f) => !used.has(f.name));
  if (!pool.length) return;
  const f = pool[Math.floor(rng(s) * pool.length)];
  // sized to the era, not to 2026 — a fund raised in year eighty is a year
  // eighty fund
  const scale = Math.max(1, living.reduce((a, r) => a + (r.aum ?? 0), 0) / 500_000_000);
  const equity = Math.round(rrange(s, 5_000_000, 15_000_000) * scale);
  const ltv = STYLE[f.style].maxLtv * rrange(s, 0.68, 0.88);
  s.rivals.push({
    id: `r${s.rivals.length}`, name: f.name, style: f.style,
    cash: equity, debt: 0, bbls: [], targetLtv: +ltv.toFixed(2), bornM: s.month,
  });
  s.news.unshift({
    q: s.month, kind: "event",
    text: `${f.name} has raised $${(equity / 1e6).toFixed(0)}M and is looking for buildings. There is competition on the tape again.`,
  });
}

/**
 * TAX ON A GAIN, the way the player pays it.
 *
 * A rival's basis is aggregate, so the gain on any one sale is estimated by
 * the share of the book that building represents. That is coarse, and it is
 * far better than the alternative, which was that the street compounded
 * capital gains tax-free for a hundred years while the player paid on every
 * disposal. Charged at the same rate the player pays.
 */
function gainsTax(r: Rival, price: number): number {
  const basis = r.basis ?? 0;
  const n = Math.max(1, r.bbls.length);
  const share = Math.min(basis, basis / n);
  const gain = Math.max(0, price - share);
  r.basis = Math.max(0, Math.round(basis - share));
  const tax = Math.round(gain * 0.25);
  r.taxPaid = (r.taxPaid ?? 0) + tax;
  return tax;
}

/**
 * A DEVELOPER PICKS UP SOMEBODY ELSE'S FRAME.
 *
 * You are not the only person in town who reads the receiver's list. A stalled
 * building that sits long enough gets taken out by a firm with the balance
 * sheet to finish it — which is what stops the map filling with permanent
 * monuments to dead sponsors, and what makes the good ones worth moving on.
 * They pay for the site and the steel and inherit the bill for the rest.
 */
function rescueOrphan(s: GameState, parcels: ParcelTable, ci: number) {
  const stalled = (s.cityJobs ?? []).filter((j) => j.orphaned && j.listedM !== undefined && s.month - j.listedM >= 6);
  if (!stalled.length) return;
  const j = stalled[Math.floor(rng(s) * stalled.length)];
  if (s.holdings[j.bbl]) return;
  const listing = s.listings.find((l) => l.bbl === j.bbl);
  const price = listing?.ask ?? 0;
  if (price <= 0) return;
  const toFinish = Math.max(0, (j.cost ?? 0) - (j.spent ?? 0));
  const taker = livingRivals(s).find((r) =>
    BUILD_APPETITE[r.style] >= 0.3
    && r.cash > price + toFinish * 0.4 + 2_000_000
    && rng(s) < 0.10 * BUILD_APPETITE[r.style] * ci);
  if (!taker) return;
  taker.cash -= price;
  taker.basis = Math.round((taker.basis ?? 0) + price);
  transferDeed(s, j.bbl, taker, price);
  j.orphaned = false;
  j.firmId = taker.id;
  j.equityLeft = Math.round(toFinish * 0.45);
  j.cost = (j.spent ?? 0) + toFinish;
  j.ratePct = +(s.econ.indexRate + CONSTR_SPREAD_R + 0.6).toFixed(2);
  // a restart is slow: new drawings, new contractor, a site that has weathered
  j.deliverM = s.month + Math.max(6, Math.round((j.deliverM - j.startM) * 0.5));
  s.listings = s.listings.filter((l) => l.bbl !== j.bbl);
  const rec = resolveRec(parcels, s, j.bbl);
  s.news.unshift({
    q: s.month, kind: "event",
    text: `${taker.name} has taken out the stalled building at ${rec?.address ?? j.bbl} for $${(price / 1e6).toFixed(2)}M. `
      + `The cranes are back and that space is coming after all.`,
  });
}

/**
 * A LAND BANK IS SUPPOSED TO BECOME BUILDINGS.
 *
 * Developer-style firms buy dirt off the tape — that is in their style config
 * and always was. What they never did was build on it, so a developer's land
 * bank was a vacant lot that bled 1.2% of its value a year forever, which is
 * not a strategy, it is a slow death. Once a month a firm looks at what it is
 * sitting on and puts up the best of it.
 */
function startOwnJob(s: GameState, parcels: ParcelTable, r: Rival, ci: number) {
  if (BUILD_APPETITE[r.style] <= 0) return;
  const live = (s.cityJobs ?? []).filter((j) => j.firmId === r.id).length;
  if (live >= (r.style === "developer" ? 2 : 1)) return;
  const phaseMult = s.econ.phase === "peak" ? 1.4 : s.econ.phase === "expansion" ? 1.2
    : s.econ.phase === "recovery" ? 0.6 : 0.12;
  if (rng(s) >= 0.022 * BUILD_APPETITE[r.style] * phaseMult * ci) return;

  // the best lot they own, by what the neighbourhood has become
  let best: { bbl: string; rec: ParcelRecord } | null = null, bestScore = -1;
  for (const bbl of r.bbls) {
    if ((s.cityJobs ?? []).some((j) => j.bbl === bbl)) continue;
    const rec = resolveRec(parcels, s, bbl);
    if (!rec || rec.class !== "land" || rec.lotArea < 2500) continue;
    const score = rec.demandScore + rng(s) * 20;
    if (score > bestScore) { bestScore = score; best = { bbl, rec }; }
  }
  if (!best) return;
  const { bbl, rec } = best;
  const use = useForZone(rec.zoneDist, rec.demandScore, rng(s));
  const lead = dominantOf(devMix(use));
  const farMax = farMaxFor(rec);
  const frac = Math.min(0.95, 0.4 + rng(s) * 0.45);
  const sf = Math.max(3000, Math.round((rec.lotArea * farMax * frac) / 100) * 100);
  const floors = Math.max(1, Math.round(sf / (rec.lotArea * 0.62)));
  const cost = jobBudget(s, use, sf, floors);
  if (cost > (r.aum ?? 0) * 0.75 + r.cash * 4) return;
  const ltc = Math.max(0.4, Math.min(0.7, 0.7 * ci));
  // the dirt is already theirs, so only the build equity has to be in the bank
  if (r.cash < Math.round(cost * (1 - ltc) * 0.45) + Math.max(1_000_000, r.cash * 0.06)) return;
  const [bLo, bHi] = BUILD_MONTHS[lead];
  const months = Math.round(bLo + rng(s) * (bHi - bLo));
  const deliverM = s.month + months;
  if (!s.cityJobs) s.cityJobs = [];
  s.cityJobs.push({
    bbl, use, sf, floors, startM: s.month, deliverM,
    firmId: r.id, cost, spent: 0,
    equityLeft: Math.round(cost * (1 - ltc)), debt: 0,
    ratePct: +(s.econ.indexRate + CONSTR_SPREAD_R).toFixed(2),
  });
  // into the delivery pipeline the day the hole is dug, exactly like the city's
  if (!s.econ.cohorts) s.econ.cohorts = { office: [], retail: [], multifamily: [], industrial: [] };
  for (const [u, share] of Object.entries(devMix(use))) {
    const usf = Math.round(sf * (share as number));
    if (usf > 0) s.econ.cohorts[u as BuiltClass].push({ m: deliverM, sf: usf });
  }
  s.news.unshift({
    q: s.month, kind: "event",
    text: `${r.name} is building on their own land at ${rec.address} — ${(sf / 1000).toFixed(0)}k sf of ${use}, `
      + `$${(cost / 1e6).toFixed(1)}M. They have been sitting on that corner waiting for this market.`,
  });
}

export function tickRivals(s: GameState, parcels: ParcelTable) {
  if (!s.rivals?.length) return;
  const ci = Math.max(0.4, Math.min(1.25, s.econ.creditIdx ?? 1));
  const rate = s.econ.indexRate + RATE_SPREAD;
  maybeNewFirm(s, ci);
  // The jobs come first: a firm's construction draw is a call on this month's
  // cash, and it has to land before the solvency test reads that cash.
  fundJobs(s);
  orphanToTape(s, parcels);
  rescueOrphan(s, parcels, ci);

  for (const r of s.rivals) {
    // THE WORKOUT. A failed firm does not evaporate — a receiver holds the
    // book and sells it down over years, because dumping a hundred buildings
    // into one month would clear at nothing and everybody knows it. Releasing
    // them a couple at a time is both what happens and what keeps a failure
    // from handing the whole market a year of free money: the first version of
    // this listed the entire portfolio at once, and the resulting flood of
    // sixty-cent buildings made the most reckless strategy in the audit the
    // best one again.
    if (r.failedM !== undefined) {
      if (!r.bbls.length) continue;
      let release = 1 + Math.floor(rng(s) * 2);
      while (release-- > 0 && r.bbls.length) {
        const bbl = r.bbls[Math.floor(rng(s) * r.bbls.length)];
        r.bbls = r.bbls.filter((b) => b !== bbl);
        if (s.holdings[bbl] || s.listings.some((l) => l.bbl === bbl)) continue;
        const rec = resolveRec(parcels, s, bbl);
        if (!rec) continue;
        const v = assetValue(rec, s.econ, initialCondition(rec));
        s.listings.push({
          bbl, ask: Math.round(v * rrange(s, 0.66, 0.86) / 1000) * 1000,
          listedM: s.month, expiresM: s.month + Math.round(rrange(s, 6, 12)), distress: true,
        });
      }
      continue;
    }
    const st = STYLE[r.style];
    tickAssetManagement(s, parcels, r);
    startOwnJob(s, parcels, r, ci);
    const { aum, noiYr, ltv } = markRival(s, parcels, r);
    r.aum = Math.round(aum);

    // --- the money -------------------------------------------------------
    // NOI in, interest and amortisation out. A firm this size amortises on a
    // thirty-year schedule; nobody gets pure interest-only forever.
    const interest = (r.debt * rate) / 100 / 12;
    const amort = r.debt > 0 ? r.debt / (30 * 12) : 0;
    r.cash += Math.round(noiYr / 12 - interest - amort);
    r.debt = Math.max(0, Math.round(r.debt - amort));

    // THE SAME OVERHEAD THE PLAYER CARRIES. Asset management, accounting,
    // audit, legal, somebody to answer the phone. It is not billable to a
    // building and it never goes away, and the street was not paying it —
    // which over a century is most of the reason their books outran yours.
    // Identical formula to the player's: a small fixed base plus ~28bps of
    // gross asset value a year, sub-linear because the tenth building is
    // cheaper to run than the first.
    if (r.bbls.length > 0) {
      r.cash -= Math.round((60_000 * s.econ.costIdx + 0.0028 * aum) / 12);
    }

    // AND THE SAME TAX. Once a year, on income after interest and
    // depreciation, at the rate the player pays. Depreciation is estimated off
    // the book rather than tracked per building — improvements are roughly
    // seven tenths of value over a blended life.
    if (s.month > 0 && s.month % 12 === 0) {
      const depr = (r.basis ?? aum) * 0.7 / 33;
      const taxable = noiYr - interest * 12 - depr;
      if (taxable > 0) {
        const tax = Math.round(taxable * 0.25);
        r.cash -= tax;
        r.taxPaid = (r.taxPaid ?? 0) + tax;
      }
    }

    // DISTRIBUTIONS. Every firm here answers to somebody — partners, a family,
    // a pension board — and none of them let a hundred years of free cash flow
    // sit in a bank account. A shop holds a working reserve and sends the rest
    // out the door, and that is why dry powder is a real constraint on a real
    // firm rather than an ever-growing number. Without it these balance sheets
    // compounded into tens of billions of idle cash, which made every firm
    // unkillable and every bidding war a foregone conclusion.
    // A DEVELOPER HOLDS POWDER, because a developer's product is a hole in the
    // ground that eats money for three years. Distributing down to a core
    // fund's working reserve is how a builder ends up unable to break ground
    // on anything — which is exactly what the street was doing.
    // Powder is held for the next job or two, not as a share of a book that
    // compounds forever — an unbounded ratio on a billion-dollar balance sheet
    // is a war chest nobody can outbid, which is not dry powder, it is a bug.
    const reserve = Math.min(
      r.style === "developer" ? 45_000_000 : 30_000_000,
      Math.max(2_000_000, aum * (
        r.style === "developer" ? 0.16 : r.style === "family" ? 0.09 : r.style === "core" ? 0.06 : 0.045)),
    );
    const building = (s.cityJobs ?? []).some((j) => j.firmId === r.id && !j.orphaned);
    if (r.cash > reserve && !r.stressMs && !building) {
      const out = Math.round((r.cash - reserve) * 0.35);
      r.cash -= out;
      r.distributed = (r.distributed ?? 0) + out;
    }

    // --- the overreach ---------------------------------------------------
    // Cheap money is a temptation and it is supposed to be taken. A firm that
    // refinances equity out at the top has more to buy with and less to lose
    // it with — which is exactly the trade that kills them two phases later.
    if (st.cashOut > 0 && ci > 1.02 && ltv < st.maxLtv - 0.06 && rng(s) < 0.06 * st.cashOut) {
      const room = Math.round((st.maxLtv - 0.04 - ltv) * aum);
      if (room > 1_000_000) {
        r.debt += room;
        r.cash += room;
      }
    }

    // --- taking profits --------------------------------------------------
    // Nobody accumulates for a hundred years without ever selling. A firm
    // trims into strength — it is where their returns are realised, it is what
    // their investors are waiting for, and it is why there is anything on the
    // tape in a good market at all. Without it the street simply ate the city.
    const hot = s.econ.phase === "peak" || s.econ.phase === "expansion";
    if (r.bbls.length > 6 && !r.stressMs && rng(s) < (hot ? 0.055 : 0.012) * (r.style === "family" ? 0.25 : 1)) {
      const bbl = r.bbls[Math.floor(rng(s) * r.bbls.length)];
      const rec = resolveRec(parcels, s, bbl);
      if (rec && !s.holdings[bbl] && !s.listings.some((l) => l.bbl === bbl)) {
        const v = assetValue(rec, s.econ, initialCondition(rec));
        // a willing seller asks a willing seller's price
        s.listings.push({
          bbl, ask: Math.round(v * rrange(s, 1.00, 1.14) / 1000) * 1000,
          listedM: s.month, expiresM: s.month + Math.round(rrange(s, 6, 12)),
        });
      }
    }

    // --- trouble ---------------------------------------------------------
    // Two ways to die, and they are the same two ways anyone dies: the value
    // fell through the debt, or the cash ran out. Neither is instant — a firm
    // sells into it first, which is what puts the tape full of good buildings
    // at bad prices exactly when nobody can finance them.
    // A FIRM WITH NOTHING LEFT TO SELL AND MONEY STILL OWED IS FINISHED.
    //
    // The stress path only ran while there were buildings to sell, and the
    // `else` reset the counter — so a firm that had sold its way down to zero
    // assets and residual debt escaped the failure test forever. It sat on the
    // street table at 900% leverage with no buildings, permanently one bad
    // cycle from being a seller it could never be.
    if (!r.bbls.length && r.debt > Math.max(0, r.cash)) {
      r.failedM = s.month;
      s.news.unshift({
        q: s.month, kind: "warn",
        text: `${r.name} is done. They sold the last building months ago and the debt outlived the portfolio — there is nothing for the receiver to take.`,
      });
      continue;
    }
    const stressed = ltv > st.maxLtv + 0.05 || r.cash < 0;
    if (stressed && r.bbls.length) {
      r.stressMs = (r.stressMs ?? 0) + 1;
      // sell something, at whatever the room will pay
      if (r.stressMs % 2 === 0) {
        const bbl = r.bbls[Math.floor(rng(s) * r.bbls.length)];
        const rec = resolveRec(parcels, s, bbl);
        if (rec) {
          const v = assetValue(rec, s.econ, initialCondition(rec));
          const px = Math.round(v * rrange(s, 0.68, 0.88));
          r.bbls = r.bbls.filter((b) => b !== bbl);
          r.cash += px - gainsTax(r, px);
          r.debt = Math.max(0, r.debt - Math.round(px * 0.92));
          if (!s.listings.some((l) => l.bbl === bbl) && !s.holdings[bbl]) {
            s.listings.push({ bbl, ask: px, listedM: s.month, expiresM: s.month + 8, distress: true });
            s.news.unshift({
              q: s.month, kind: "event",
              text: `${r.name} is selling. ${rec.address} hits the tape at $${(px / 1e6).toFixed(2)}M — ${Math.round((1 - px / Math.max(1, v)) * 100)}% under appraisal. They have more where that came from.`,
            });
          }
        }
      }
      if (r.stressMs > 30 && (r.cash < 0 || ltv > st.maxLtv + 0.2)) {
        r.failedM = s.month;
        s.news.unshift({
          q: s.month, kind: "warn",
          text: `${r.name} is finished — ${r.bbls.length} building${r.bbls.length === 1 ? "" : "s"} go to the lenders. A firm that was buying everything two years ago could not roll a single loan this month. The receiver will be selling for years.`,
        });
      }
    } else if (r.stressMs) {
      r.stressMs = 0;
    }
  }
}

/**
 * Somebody else takes the deal. Called from listing absorption so the buyer
 * has a name — losing a building to Kestrel Capital twice in a year is
 * information, and "another buyer" was not.
 *
 * Returns the firm that bought it, or null if the money in the room today
 * could not close.
 */
export function rivalBuys(s: GameState, rec: ParcelRecord, price: number): Rival | null {
  // A listing may already belong to somebody — a firm selling out of a
  // position, or a receiver clearing a failed one. Whoever holds the deed is
  // the seller, and they are obviously not also the buyer.
  const seller = ownerOf(s, rec.bbl);
  // THEY BUY WITH THEIR OWN MONEY, AND ONLY WHAT A LENDER WOULD FUND.
  //
  // The cash test was already here — a firm without the equity does not close.
  // What was missing is the other half of every real acquisition: the debt has
  // to be lendable. A firm already at its covenant cannot put another loan on
  // top just because it happens to have cash in the account, and no firm gets
  // a construction-era loan out of a shut credit market. Both are checks the
  // player has to pass on every deal; the street passes them now too.
  const ci = Math.max(0.4, Math.min(1.25, s.econ.creditIdx ?? 1));
  const candidates = livingRivals(s).filter((r) => {
    if (r === seller) return false;
    const st = STYLE[r.style];
    if (st.classes && !st.classes.includes(rec.class)) return false;
    // In a shut credit market the loan is smaller, so the cheque is bigger —
    // which is exactly why a downturn is when a disciplined buyer with cash
    // gets to name their price.
    const ltvNow = Math.min(r.targetLtv, st.maxLtv) * (ci < 0.8 ? 0.82 : 1);
    const equity = price * (1 - ltvNow);
    // a working reserve is not dry powder: nobody spends their last dollar
    if (r.cash < equity + Math.max(500_000, r.cash * 0.05)) return false;
    // and the debt has to be lendable against the book they already carry
    const aumAfter = (r.aum ?? 0) + price;
    const debtAfter = r.debt + (price - equity);
    if (aumAfter > 0 && debtAfter / aumAfter > st.maxLtv) return false;
    return true;
  });
  if (!candidates.length) return null;
  // the hungriest firm with the money wins
  let best = candidates[0], bestW = -Infinity;
  for (const r of candidates) {
    const st = STYLE[r.style];
    const w = st.appetite * (1 + st.procyclical * ((s.econ.creditIdx ?? 1) - 1)) * (0.6 + rng(s) * 0.8);
    if (w > bestW) { bestW = w; best = r; }
  }
  if (seller) {
    seller.bbls = seller.bbls.filter((b) => b !== rec.bbl);
    const relief = Math.min(seller.debt, Math.round(price * seller.targetLtv));
    seller.debt -= relief;
    seller.cash += price - relief - gainsTax(seller, price);
  }
  const bestLtv = Math.min(best.targetLtv, STYLE[best.style].maxLtv) * (ci < 0.8 ? 0.82 : 1);
  const equity = Math.round(price * (1 - bestLtv));
  // Closing costs. The player has always paid two points to get a deed across
  // a table; the street was getting them free, which over a century is most of
  // a firm.
  const closing = Math.round(price * 0.02);
  best.cash -= equity + closing;
  best.debt += price - equity;
  best.basis = Math.round((best.basis ?? 0) + price + closing);
  best.aum = Math.round((best.aum ?? 0) + price);
  transferDeed(s, rec.bbl, best, 0);   // the seller was already paid above
  recordComp(s, rec, price, best.name, seller?.name ?? "a private owner",
    s.listings.find((l) => l.bbl === rec.bbl)?.distress, seller ? assetGrade(seller, rec) : undefined);
  return best;
}

/** What a rival will take for a building of theirs, and why. */
export function rivalAsk(s: GameState, parcels: ParcelTable, r: Rival, bbl: string): { ask: number; note: string } {
  const rec = resolveRec(parcels, s, bbl);
  const v = rec ? assetValue(rec, s.econ, initialCondition(rec)) : 0;
  const { ltv } = markRival(s, parcels, r);
  const st = STYLE[r.style];
  if (r.stressMs && r.stressMs > 4) {
    return { ask: Math.round(v * rrange(s, 0.80, 0.95)), note: `${r.name} needs the money — they are inside appraisal and they know you know.` };
  }
  if (ltv < st.maxLtv * 0.6 && r.style === "family") {
    return { ask: Math.round(v * rrange(s, 1.18, 1.45)), note: `${r.name} has owned it for two generations and does not need to sell. That is the number.` };
  }
  return { ask: Math.round(v * rrange(s, st.patience - 0.04, st.patience + 0.12)), note: `${r.name} will trade at the right price.` };
}
