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
import { CASH_APY, monthLabel } from "./types";
import { BUILD_MONTHS, rng, rrange, devPencils } from "./market";
import { assetValue, initialCondition, inPlace, landValue, noiAfterTaxYr, occupancy, resolveRec } from "./value";
import { cityInfillCap, devMix, dominantOf, farMaxFor, HARD_COST_PSF, MAX_FLOORS_BY_USE, retailWantsMixed, SOFT_COST, useForZone, noteRecordPlan, openConstructionDesks, pickConstructionDesk, capRetail, withStreetRetail } from "./dev";
import { CONSTRUCTION_LENDER, chargeLenderLoss } from "./lenders";
import { streetRefiProceeds, productById } from "./debt";
import { deskWillExtend, extensionFeePct, NOTICE_M, FORECLOSE_M } from "./workout";
import { recordComp } from "./comps";
import { demandNow } from "./demand";

// Ashport is an old port town; its money has old-port-town names.
// A DOZEN FIRMS, NOT SIX. Six was enough to have somebody to lose a deal to;
// it was not enough for the street to have a texture — for there to be two old
// families who never sell and three levered shops racing each other into the
// same peak.
//
// NOBODY STARTS BIGGER THAN YOU BY MUCH. These ran to eighteen million against
// your six, which meant the largest firms opened the century with three times
// your buying power and never gave it back — you were not competing with them
// so much as watching them. Four to ten million now: some start behind you,
// the biggest starts at ten, and what they end up owning they earned inside
// the sim rather than at character creation.
//
// THIRTY-FIVE OF THEM, AND THE SIZE DISTRIBUTION IS THE POINT. A real property
// market is not a dozen equals; it is a power law. A handful of shops own most
// of what matters, a middle tier trades constantly, and a long tail of family
// holdings sit on four buildings and a parking lot and will not sell to anyone
// at any price. Twelve firms produced a market where every bid you lost, you
// lost to somebody you already knew; thirty-five produces one where the corner
// you want is quietly owned by a name you have never heard of, and where a
// self-inflicted glut has thirty-four other balance sheets to travel through
// before it comes back to yours.
//
// The cap stays at ten million. Nobody starts meaningfully bigger than you —
// what the big ones end up owning, they earn inside the sim.
const FIRMS: { name: string; style: RivalStyle; equity: number; ltv: number }[] = [
  // --- the establishment: patient money, low leverage, never a forced seller
  { name: "Calloway & Reed", style: "family", equity: 7_000_000, ltv: 0.32 },
  { name: "Harbor Point Partners", style: "core", equity: 9_000_000, ltv: 0.52 },
  { name: "Wentworth Trust", style: "family", equity: 10_000_000, ltv: 0.41 },
  { name: "Granite Mutual", style: "reit", equity: 10_000_000, ltv: 0.44 },
  { name: "Thorne & Boyle", style: "family", equity: 6_000_000, ltv: 0.28 },
  { name: "Wrenfield Brothers", style: "family", equity: 5_000_000, ltv: 0.35 },
  { name: "Ashcombe Estate Co.", style: "foreign", equity: 6_800_000, ltv: 0.26 },
  { name: "The Delancey Trust", style: "core", equity: 9_500_000, ltv: 0.38 },
  // --- the middle: the firms you will actually bid against, week in week out
  { name: "Meridian Yield Group", style: "pe", equity: 5_500_000, ltv: 0.71 },
  { name: "Alden Development Co.", style: "developer", equity: 8_000_000, ltv: 0.66 },
  { name: "Kestrel Capital", style: "opportunistic", equity: 4_000_000, ltv: 0.78 },
  { name: "Longwharf Realty", style: "merchant", equity: 6_500_000, ltv: 0.69 },
  { name: "Pell Street Holdings", style: "opportunistic", equity: 4_500_000, ltv: 0.82 },
  { name: "Tidewater Development", style: "developer", equity: 8_500_000, ltv: 0.72 },
  { name: "Barrowgate Realty", style: "reit", equity: 7_200_000, ltv: 0.55 },
  { name: "Fairlead Capital", style: "pe", equity: 5_200_000, ltv: 0.74 },
  { name: "Stonecutter Partners", style: "merchant", equity: 7_400_000, ltv: 0.70 },
  { name: "Mercer & Vane", style: "core", equity: 6_600_000, ltv: 0.49 },
  { name: "Rookery Investments", style: "vulture", equity: 4_800_000, ltv: 0.80 },
  { name: "Hollis Yard Group", style: "developer", equity: 5_800_000, ltv: 0.75 },
  { name: "Kingsbridge Realty", style: "core", equity: 8_200_000, ltv: 0.46 },
  { name: "Almond Court Capital", style: "opportunistic", equity: 3_800_000, ltv: 0.83 },
  // --- the tail: small, local, stubborn, and almost impossible to buy out
  { name: "Vasilis Brothers", style: "slumlord", equity: 3_200_000, ltv: 0.30 },
  { name: "O'Hare & Daughters", style: "family", equity: 2_800_000, ltv: 0.24 },
  { name: "Castellane Holdings", style: "owneruser", equity: 3_600_000, ltv: 0.33 },
  { name: "Brannock Property Co.", style: "slumlord", equity: 2_600_000, ltv: 0.22 },
  { name: "Ninth Ward Realty", style: "vulture", equity: 2_900_000, ltv: 0.79 },
  { name: "Tallow Lane Partners", style: "pe", equity: 3_100_000, ltv: 0.77 },
  { name: "Ferro Construction Co.", style: "merchant", equity: 3_400_000, ltv: 0.76 },
  { name: "Wexler Building Co.", style: "developer", equity: 4_100_000, ltv: 0.73 },
  { name: "Prosper Ridge Group", style: "reit", equity: 4_400_000, ltv: 0.51 },
  { name: "Anwar Estates", style: "owneruser", equity: 3_000_000, ltv: 0.27 },
  { name: "Chandler & Roe", style: "opportunistic", equity: 3_500_000, ltv: 0.81 },
  { name: "Marlowe Kimball", style: "foreign", equity: 5_000_000, ltv: 0.47 },
  { name: "Sixpenny Holdings", style: "family", equity: 2_500_000, ltv: 0.20 },
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
  /**
   * TARGET HOLD, IN MONTHS, and 0 means forever. This is the field that makes
   * a personality a personality rather than a leverage setting: a merchant
   * builder and a family office can want the same building for opposite
   * reasons and be on opposite sides of the trade three years later.
   */
  holdM: number;
  /**
   * WHICH WAY THE CREDIT WINDOW MOVES THEM. Almost everyone buys more when
   * money is cheap. A vulture buys when it is gone, and a family office quietly
   * buys the things nobody else can finance. Negative inverts `procyclical`.
   */
  contra: number;
  /** how far they will chase a DISTRESSED listing specifically */
  distressBias: number;
}> = {
  // sold their soul to nobody; buys quality, holds forever, sleeps at night
  family:        { appetite: 0.30, procyclical: 0.5, maxLtv: 0.50, cashOut: 0.00, classes: null, patience: 1.02, holdM: 0, contra: 0.25, distressBias: 1.1 },
  // institutional money: steady, disciplined, buys stabilised income
  core:          { appetite: 0.75, procyclical: 1.0, maxLtv: 0.65, cashOut: 0.20, classes: ["office", "multifamily"], patience: 1.06, holdM: 168, contra: 0, distressBias: 0.7 },
  // the ones who win the last three years of every cycle and lose the next one
  opportunistic: { appetite: 1.25, procyclical: 1.9, maxLtv: 0.88, cashOut: 0.85, classes: null, patience: 1.16, holdM: 84, contra: 0, distressBias: 1.4 },
  // buys dirt and puts buildings on it; the city's growth is partly theirs
  developer:     { appetite: 0.85, procyclical: 1.5, maxLtv: 0.78, cashOut: 0.55, classes: ["land", "industrial", "retail"], patience: 1.10, holdM: 120, contra: 0, distressBias: 0.9 },

  // --- and the seven the street was missing ---------------------------------

  // MERCHANT BUILDER. Builds to sell — the fee is in the delivery, not the
  // hold, and a merchant who is still holding a building at year four has made
  // a mistake and knows it. Buys land, almost nothing else.
  merchant:      { appetite: 0.55, procyclical: 1.7, maxLtv: 0.80, cashOut: 0.30, classes: ["land"], patience: 1.08, holdM: 42, contra: 0, distressBias: 0.6 },
  // LOCAL PRIVATE EQUITY, on an IRR clock. Buy something tired, fix it, exit by
  // year five, because an IRR is a function of TIME and the fund has a life.
  // The clock is the whole personality: they will sell a good building into a
  // bad market because the deadline does not care what the market is doing.
  pe:            { appetite: 1.05, procyclical: 1.4, maxLtv: 0.75, cashOut: 0.70, classes: null, patience: 1.12, holdM: 60, contra: 0, distressBias: 1.2 },
  // LISTED REIT. Has to keep paying the dividend, which means it is never
  // out of the market and never truly patient — it must keep the yield up and
  // it cannot cut distributions without being punished for it.
  reit:          { appetite: 0.95, procyclical: 1.1, maxLtv: 0.58, cashOut: 0.45, classes: ["office", "retail", "multifamily"], patience: 1.05, holdM: 240, contra: 0, distressBias: 0.8 },
  // VULTURE. Dormant in a boom and ravenous in a bust — the only firm on this
  // street whose appetite RISES as credit closes, which is what makes a
  // receiver's book contested even in the worst year.
  vulture:       { appetite: 0.65, procyclical: 0.4, maxLtv: 0.60, cashOut: 0.20, classes: null, patience: 1.03, holdM: 96, contra: -1.6, distressBias: 2.6 },
  // OWNER-OCCUPIER. A company buying its own premises. It does not price the
  // building off a cap rate and it never sells, so every deed it takes leaves
  // the market permanently — which is exactly what a corporate headquarters
  // purchase does to a submarket's available stock.
  owneruser:     { appetite: 0.35, procyclical: 0.7, maxLtv: 0.55, cashOut: 0.00, classes: ["office", "industrial"], patience: 1.20, holdM: 0, contra: 0.2, distressBias: 0.5 },
  // OFFSHORE CAPITAL buying safety rather than yield. Pays up for the trophy,
  // uses almost no debt, and turns up when the city is fashionable.
  foreign:       { appetite: 0.50, procyclical: 1.3, maxLtv: 0.35, cashOut: 0.05, classes: ["office", "multifamily"], patience: 1.28, holdM: 0, contra: 0, distressBias: 0.4 },
  // THE MILKER. Buys the worst stock at the worst prices and spends nothing on
  // it, which works for years and then does not. Its buildings are where the
  // city's obsolescence accumulates.
  slumlord:      { appetite: 0.70, procyclical: 0.9, maxLtv: 0.72, cashOut: 0.60, classes: ["multifamily", "retail", "industrial"], patience: 0.96, holdM: 0, contra: 0.3, distressBias: 1.8 },
};

/** The style table, for modules that need to read a firm's temperament. */
export const STYLE_OF = (k: RivalStyle) => STYLE[k];

const RATE_SPREAD = 1.9;   // what a firm of this size pays over the index

// HOW MUCH OF THE BOOK IS ACTUALLY AMORTISING.
//
// Every firm used to pay down a thirtieth of its entire book every year, which
// at eighty per cent leverage is 2.7% of gross asset value a year on top of
// interest — enough on its own to make a levered shop structurally cash-flow
// negative. Measured consequence: opportunistic firms lived 5.3 years and
// developers 8.0, the street ran 0.61 living opportunistic shops and 0.77
// developers against three of each at the start, and the entire rival news
// feed became a rolling obituary.
//
// Family capital pays its buildings off, because that is what family capital
// is for. A core fund amortises most of its book. An opportunistic shop and a
// developer buy on interest-only paper, because the business plan is an exit
// in five years and nobody amortises through a hold they intend to sell out of.
const AMORT_SHARE: Record<RivalStyle, number> = {
  family: 1, core: 0.85, opportunistic: 0.25, developer: 0.35,
  // A merchant builder and a private-equity fund both intend to be gone before
  // the first principal payment matters. A REIT amortises because its lenders
  // and its rating make it. An owner-user pays its building off like a mortgage
  // on a house. Offshore capital barely borrows. A slumlord services what it
  // must and no more.
  merchant: 0.15, pe: 0.20, reit: 0.75, vulture: 0.45,
  owneruser: 1, foreign: 0.90, slumlord: 0.30,
};

// ---------------------------------------------------------------- building
//
// How much of the city's own pipeline each kind of firm is willing to own.
// A developer is in the business; an opportunistic shop builds when the money
// is free and regrets it; core and family capital does not take construction
// risk, because that is the entire point of core and family capital.
const BUILD_APPETITE: Record<RivalStyle, number> = {
  developer: 1, opportunistic: 0.3, core: 0.06, family: 0,
  // A merchant builder is MORE of a builder than a developer is — building is
  // the entire business and the hold is an accident. Everybody else has a
  // reason not to take construction risk, and the reason differs.
  merchant: 1.25, pe: 0.35, reit: 0.10, vulture: 0.05,
  owneruser: 0.20, foreign: 0, slumlord: 0,
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
  // WHEN THE DEED ARRIVED. A hold period is the difference between a family
  // office and a private-equity fund, and it cannot be modelled without
  // knowing how long each building has actually been owned.
  (to.heldSince ??= {})[bbl] = s.month;
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
  // WHETHER THIS CORNER IS NEXT DOOR TO SOMETHING YOU OWN. Computed at the
  // call site, where the adjacency table is already in scope.
  nearPlayer = false,
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
    // A DEVELOPER GOES WHERE SOMEBODY HAS ALREADY PROVED THE BLOCK. Your
    // building is the comp that makes their pro forma work, which is exactly
    // why the crane goes up across the street from the last one that worked.
    return rng(s) < 0.5 * want * phaseMult * ci * (nearPlayer ? 3 : 1);
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
    text: nearPlayer
      ? `${best.name} has broken ground at ${rec.address} — ${(sf / 1000).toFixed(0)}k sf of ${use}, ${(cost / 1e6).toFixed(1)}M, `
        + `due ${2000 + Math.floor(deliverM / 12)}. That is next door to yours. Your corner is worth more the day it tops out and your tenants have somewhere else to go the day it opens.`
      : `${best.name} has broken ground at ${rec.address} — ${(sf / 1000).toFixed(0)}k sf of ${use}, `
        + `${(cost / 1e6).toFixed(1)}M, due ${2000 + Math.floor(deliverM / 12)}. That space is coming whether you want it or not.`,
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

    // THEIR BANK FAILED TOO. No draws, so the month's work in place comes out
    // of the sponsor's own account, and the receiver's interest comes out of
    // it as well instead of capitalising. A firm with a balance sheet carries
    // the job to the finish; a firm without one leaves a frame standing on the
    // corner, and orphanToTape puts that frame in front of the player at land
    // plus a fraction of the sunk cost. This is why a seizure is the best
    // buying window in the game — it is not a bonus, it is somebody's job.
    if (j.repudiatedM !== undefined) {
      const carry = Math.round(((j.debt ?? 0) * (j.ratePct ?? 8)) / 100 / 12);
      if (r.cash < spend + carry) {
        j.orphaned = true;
        s.news.unshift({
          q: s.month, kind: "event",
          text: `${r.name} has stopped work. Their construction lender was seized, nobody would refinance the job, `
            + `and they have run out of cash to carry it themselves. The frame stands where it stands.`,
        });
        continue;
      }
      r.cash -= spend + carry;
      j.equityLeft = Math.max(0, (j.equityLeft ?? 0) - spend);
      j.spent = (j.spent ?? 0) + spend;

      // And the same way out the player has: another desk, once the paperwork
      // is done, and only if its advance rate on the whole cost clears what is
      // already owed to the receiver.
      if (s.month >= (j.replaceM ?? 0)) {
        const desk = openConstructionDesks(s)
          .filter((d) => d.name !== (j.lender ?? CONSTRUCTION_LENDER))
          .find((d) => d.cap * (j.cost ?? 0) > (j.debt ?? 0));
        if (desk) {
          j.lender = desk.name;
          // The premium a desk charges to step into a receiver's shoes — the
          // same one orphanToTape's takeover paper carries, for the same
          // reason. It is not a new number.
          j.ratePct = +(s.econ.indexRate + CONSTR_SPREAD_R + 0.6).toFixed(2);
          delete j.repudiatedM;
          delete j.replaceM;
        }
      }
      continue;
    }

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
 * SOMEBODY LENT THEM THAT MONEY.
 *
 * A firm on this street dies two ways and the news says so both times — "the
 * debt outlived the portfolio", "the buildings go to the lenders" — and until
 * now not one dollar of it reached a lender's balance sheet. Thirty-two of
 * fifty firms failed across a fifty-year run and the two bank desks' worst
 * delinquency in the whole century was 4.89%, against a market whose office
 * vacancy peaked at 28.9%. Their capital never came within a point of their
 * target, so no bank could ever fail, so every consequence hanging off a bank
 * failure — the insured deposits, the receiver's dividend, the repudiated
 * construction commitments — was machinery that could not engage.
 *
 * That is the whole 1990 mechanism and it was open at one end. Developers go
 * under; the banks that financed them eat it; enough of that and the bank goes
 * under too. This closes it.
 *
 * WHOSE LOSS IT IS. Construction debt names its desk — a job carries the
 * lender that wrote it — so that part is known rather than guessed. The rest
 * is term paper, and the model does not track which desk wrote which mortgage
 * for a firm on the street. It is allocated across the live desks by book
 * share, because a bigger book holds more of this town's paper. That is an
 * allocation, not a fact the engine knows, and it is written here as one.
 */
function chargeSponsorFailure(s: GameState, parcels: ParcelTable, r: Rival) {
  if (r.debt <= 0) return;
  // What the receiver gets back: the cash, and the buildings sold into the
  // market that killed the borrower — the same distressed band the firm was
  // already selling into on its way down, not a second invented number.
  let recovered = Math.max(0, r.cash);
  for (const bbl of r.bbls) {
    const rec = resolveRec(parcels, s, bbl);
    if (!rec) continue;
    recovered += assetValue(rec, s.econ, assetGrade(r, rec)) * rrange(s, 0.68, 0.88);
  }
  const loss = Math.round(r.debt - recovered);
  if (loss <= 0) return;

  const exposure: Record<string, number> = {};
  let known = 0;
  for (const j of s.cityJobs ?? []) {
    if (j.firmId !== r.id || !(j.debt ?? 0)) continue;
    const name = j.lender ?? CONSTRUCTION_LENDER;
    exposure[name] = (exposure[name] ?? 0) + (j.debt ?? 0);
    known += j.debt ?? 0;
  }
  const term = Math.max(0, r.debt - known);
  const live = (s.lenders ?? []).filter((l) => l.failedM === undefined);
  const books = live.reduce((a, l) => a + l.book, 0);
  if (term > 0 && books > 0) {
    for (const l of live) exposure[l.name] = (exposure[l.name] ?? 0) + term * (l.book / books);
  }
  const total = Object.values(exposure).reduce((a, x) => a + x, 0);
  if (total <= 0) return;

  let worst = { name: "", amt: 0 };
  for (const [name, exp] of Object.entries(exposure)) {
    const share = Math.round((loss * exp) / total);
    chargeLenderLoss(s, name, share);
    if (share > worst.amt) worst = { name, amt: share };
  }
  // Only when it is big enough to be a story. A desk taking a hole worth more
  // than a twentieth of its book is news in this town.
  const wl = live.find((l) => l.name === worst.name);
  if (wl && worst.amt > wl.book * 0.02) {
    s.news.unshift({
      q: s.month, kind: "warn",
      text: `${worst.name} is carrying the biggest piece of the ${r.name} failure — about `
        + `$${(worst.amt / 1e6).toFixed(1)}M of a $${(loss / 1e6).toFixed(1)}M hole. `
        + `Somebody lent them that money, and this is the month it stops being an asset.`,
    });
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

/**
 * WHO ELSE IS IN THIS TOWN, and it should not be the same answer every time.
 *
 * FIRMS is the population of operators this city could have produced. It used
 * to be the roster, entire and identical in every game: the same thirty-five
 * names with the same capital and the same leverage, which is why a hundred
 * years later the same family office had won. Measured over twenty-two
 * unplayed centuries, Wentworth Trust finished first in eleven of them and
 * every single winner was one of five family offices — not an emergent dynasty
 * so much as the same race run twenty-two times.
 *
 * A city has the firms it happens to have. Some never got founded, some raised
 * more than others, and the one that ends up owning the place is not
 * determined on day one. So each game draws its own field: most of the
 * population turns up, a handful do not, and what they came to the table with
 * varies the way real capital raises vary.
 *
 * The bands are deliberately narrow on leverage and wide on equity. How much a
 * firm raised is a fact about its investors; how much it is willing to borrow
 * is a fact about its character, and character is what STYLE already encodes.
 */
function rosterFor(s: GameState): typeof FIRMS {
  const out: typeof FIRMS = [];
  for (const f of FIRMS) {
    // A quarter of the field, at most, never got off the ground in this city.
    if (rng(s) < 0.14) continue;
    out.push({
      ...f,
      equity: Math.round(f.equity * rrange(s, 0.55, 1.75) / 100_000) * 100_000,
      ltv: +Math.max(0.15, Math.min(0.82, f.ltv + rrange(s, -0.06, 0.06))).toFixed(3),
    });
  }
  // A town with four landlords is not a market. If the draw thinned the field
  // too far, take the population as it stands.
  return out.length >= 22 ? out : FIRMS.map((f) => ({ ...f }));
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
  rosterFor(s).forEach((f, i) => {
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
export function assetGrade(r: Rival, rec: ParcelRecord): Condition {
  const base = initialCondition(rec);
  const c = r.condIdx ?? 0.8;
  // RECENTRED ON WHAT THE INDEX ACTUALLY DOES. Measured over a hundred and
  // fifty firm-years: condIdx runs p25 0.73, p50 0.80, p75 0.89. Against the
  // old cuts a good operator's notch fired on 39% of the street's stock and a
  // bad one's on 0.2% — so "they let their buildings go" was a grade nobody
  // could reach, and the street was marked up on average. On the quartiles it
  // is a real spread: about a quarter of the city's firm-owned stock run down,
  // about a quarter kept properly, the rest exactly its age.
  const notch = c > 0.88 ? 1 : c > 0.70 ? 0 : -1;
  const i = Math.max(0, Math.min(2, GRADES.indexOf(base) + notch));
  return GRADES[i];
}

/**
 * WHAT GRADE THIS BUILDING IS ACTUALLY IN TODAY.
 *
 * Its year, moved one notch by whoever has been running it. This is the only
 * honest answer to "what condition is it in", and until now the game asked a
 * different question — `initialCondition(rec)`, which is a pure function of
 * yearBuilt — at every price it quoted: the tape's ask, the broker's whisper,
 * the lender's underwriting, and the deed itself. So a levered shop could
 * defer the roof for twenty years, the street table could print "worn · $0 of
 * capital spent this year" beside its name, and the building still sold at,
 * and arrived as, exactly what its birth year said. One grade is worth about a
 * third of the value of a building. That is not a detail to leave on the floor.
 *
 * A dead firm's book is the receiver's problem and reverts to the building's
 * own age — nobody has been running it at all.
 */
export function gradeOf(s: GameState, rec: ParcelRecord): Condition {
  const r = ownerOf(s, rec.bbl);
  return r && r.failedM === undefined ? assetGrade(r, rec) : initialCondition(rec);
}

/**
 * THE LEDGER BETWEEN YOU AND ONE FIRM, created on first contact.
 *
 * Every path that changes what a firm thinks of you goes through here, because
 * there are only three things that ever happen between two principals: you
 * traded, they beat you, or you insulted them.
 */
export function tie(s: GameState, firmId: string) {
  s.street = s.street ?? {};
  s.street[firmId] = s.street[firmId] ?? { deals: 0, beats: 0, insults: 0, lastM: s.month };
  s.street[firmId].lastM = s.month;
  return s.street[firmId];
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
  for (const bbl of r.bbls) {
    const rec = resolveRec(parcels, s, bbl);
    if (!rec) continue;
    const a = markAsset(s, r, rec);
    aum += a.v;
    noi += a.noi;
  }
  return { aum, noiYr: noi, ltv: aum > 0 ? r.debt / aum : r.debt > 0 ? 9 : 0 };
}

/**
 * ONE BUILDING OUT OF A FIRM'S BOOK, marked the way the book is marked.
 *
 * Lifted out of `markRival` unchanged, because the refinancing cliff below has
 * to size a loan against a SINGLE asset and a second expression for "what is
 * this building of theirs worth and what does it earn" would be the same
 * quantity with two answers — the exact fault this file already documents in
 * `debtReleasedOnSale`. The sum of these over `r.bbls` is `markRival`, by
 * construction rather than by agreement.
 */
function markAsset(s: GameState, r: Rival, rec: ParcelRecord): { v: number; noi: number } {
  const cond = assetGrade(r, rec);
  const v = assetValue(rec, s.econ, cond);
  if (rec.class === "land" || !rec.bldgArea) return { v, noi: noiAfterTaxYr(rec, s.econ, cond, v) };
  // Against the book's OWN market occupancy, not this building's. `r.occ`
  // is a portfolio average; dividing it by an individual building's
  // occupancy handed a firm a 35% uplift on every troubled asset it owned —
  // exactly the assets that should be dragging the mark down.
  const bookMkt = Math.max(0.35, r.mktOcc ?? 0.88);
  const ratio = Math.max(0.35, Math.min(1.2, (r.occ ?? bookMkt) / bookMkt));
  return {
    v: v * (0.42 + 0.58 * ratio),
    noi: noiAfterTaxYr(rec, s.econ, cond, v) * ratio,
  };
}

// How hard each kind of firm works its buildings. An institution runs a
// leasing team and a capital plan; a levered opportunistic shop defers the
// roof because the roof is not in this year's model.
const CARE: Record<RivalStyle, { lease: number; capex: number }> = {
  family:        { lease: 0.9,  capex: 1.15 },
  core:          { lease: 1.15, capex: 1.2 },
  opportunistic: { lease: 0.85, capex: 0.45 },
  developer:     { lease: 1.0,  capex: 0.8 },
  // A merchant builder's buildings are new, so there is nothing to spend on
  // yet. A private-equity fund spends HARD for three years and then stops,
  // because the capital plan is the business plan and it ends at the exit — it
  // is modelled here as high capex and hard leasing. A REIT keeps its assets
  // institutional because that is what the analysts look at. An owner-user
  // maintains its own house. A slumlord spends nothing at all, and its
  // buildings are where the city's obsolescence goes to live.
  merchant:      { lease: 1.0,  capex: 0.9 },
  pe:            { lease: 1.25, capex: 1.1 },
  reit:          { lease: 1.1,  capex: 1.15 },
  vulture:       { lease: 0.95, capex: 0.6 },
  owneruser:     { lease: 1.3,  capex: 1.05 },
  foreign:       { lease: 0.8,  capex: 0.95 },
  slumlord:      { lease: 0.7,  capex: 0.10 },
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
    a += st.appetite * Math.max(0.05, 1 + st.procyclical * (ci - 1) + st.contra * (1 - ci))
      * Math.min(1.15, 0.2 + dry);
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
  { name: "Drydock Holdings", style: "merchant" },
  { name: "Ostrander Group", style: "vulture" },
  { name: "Bellweather Estates", style: "family" },
  { name: "Quarry Lane Capital", style: "reit" },
  { name: "Alden Municipal Pension", style: "core" },
  { name: "Fen & Marrow", style: "pe" },
  { name: "Corbin Whitlock", style: "opportunistic" },
  { name: "Saltmarsh Trust", style: "slumlord" },
  { name: "Ironbound Development", style: "developer" },
  { name: "Halyard Investors", style: "foreign" },
  { name: "Verity Street Capital", style: "pe" },
  { name: "Merrow & Sons", style: "family" },
  { name: "Pilotage Partners", style: "merchant" },
  { name: "Consolidated Wharf Co.", style: "core" },
  { name: "Redgrave Capital", style: "vulture" },
  { name: "Bexley Holdings", style: "reit" },
  { name: "Talbot Row Partners", style: "merchant" },
  { name: "Nakamura Realty", style: "owneruser" },
  { name: "Cormorant Bay Group", style: "opportunistic" },
  { name: "Fielding & Crane", style: "core" },
  { name: "Osgood Property Trust", style: "foreign" },
  { name: "Ravensworth Development", style: "developer" },
  { name: "Beaumont Ledger Co.", style: "slumlord" },
  { name: "Halloran Brothers", style: "pe" },
  { name: "Windlass Partners", style: "family" },
  { name: "Cheswick Estates", style: "developer" },
  { name: "Portland Row Capital", style: "core" },
  { name: "Ilyushin Development", style: "merchant" },
  { name: "Fairweather & Co.", style: "reit" },
  { name: "Sanderling Trust", style: "owneruser" },
  { name: "Okonkwo Holdings", style: "vulture" },
  { name: "Bridgewright Partners", style: "developer" },
];
// AND THE TOWN DOES NOT RUN OUT OF NAMES.
//
// `NEW_FIRMS` is thirty-four of them, which is a supply and therefore a rail.
// Measured over three unplayed centuries: 60.3 firms had ever existed by year
// 100 against a stock of about sixty-four, so the last two decades of a long
// career were entered by nobody — not because the market was crowded but
// because the game had run out of nouns, and no amount of opportunity could
// have brought a fund in. When the written list is spent the town coins one,
// the way a town does. The style is drawn from the same mix `NEW_FIRMS` already
// encodes rather than from a second table, so the composition of new capital is
// one distribution and not two.
const SURNAMES = [
  "Ashby", "Beckwith", "Coyne", "Dunmore", "Everleigh", "Fenwick", "Garrity",
  "Haverford", "Ingersoll", "Jessup", "Kilbride", "Lanterman", "Moresby",
  "Norrington", "Ovington", "Prentiss", "Quimby", "Rothwell", "Selkirk",
  "Thackeray", "Underhill", "Vance", "Wardlow", "Yarrow", "Ziegler",
];
const HOUSES = [
  "Partners", "Capital", "Holdings", "& Sons", "Realty",
  "Development Co.", "Trust", "Investors", "Property Group", "& Co.",
];

function coinFirm(s: GameState, used: Set<string>): { name: string; style: RivalStyle } | null {
  for (let i = 0; i < 40; i++) {
    const name = `${SURNAMES[Math.floor(rng(s) * SURNAMES.length)]} ${HOUSES[Math.floor(rng(s) * HOUSES.length)]}`;
    if (used.has(name)) continue;
    return { name, style: NEW_FIRMS[Math.floor(rng(s) * NEW_FIRMS.length)].style };
  }
  return null;
}

// HOW LONG A FIRST FUND TAKES TO RAISE, and it is the only clock in the entry
// rule. Twelve to eighteen months from "there is money to be made in this town"
// to a first close is what a first-time sponsor actually experiences: the
// meetings, the consultant, the legal, the first anchor. It sets the scale of
// the hazard below — one full unit of opportunity brings one new fund in about
// the time one new fund takes to raise — so the number is a fact about
// fundraising rather than a dial pointed at a firm count.
const RAISE_M = 14;

/**
 * NEW CAPITAL ENTERS BECAUSE THERE IS MONEY TO BE MADE.
 *
 * The old rule was a floor and a window: refill only while fewer than 24 firms
 * are standing, at 4.5% a month, and only when the credit index is above 0.88.
 * Both halves are backwards. The floor is a rail holding the model up — a firm
 * count is an OUTPUT of how good this business is, not an input — and the
 * credit gate shut the door in precisely the years a first fund gets raised.
 * Nobody raised a real estate fund in 1988. Everybody raised one in 1992.
 * Measured on the old rule: the window is open 52.8% of months and the street
 * still bled from 25 living firms to 18.3 across fifty years.
 *
 * What a first-time sponsor is actually pitching is two sentences, and both of
 * them are numbers this engine already knows:
 *
 *   POSITIVE LEVERAGE. Buildings are trading at a going-in yield above the cost
 *   of the money, so a levered dollar is accretive from day one. The comparison
 *   is against the coupon rather than the mortgage constant because a first
 *   fund buys on interest-only paper — see the constant discussion in debt.ts.
 *   Measured across three fifty-year runs, the spread runs p25 −1.06, p50
 *   −0.27, p75 +0.68 and is positive in 41% of months — negative through
 *   expansion and peak, positive through recession and recovery, which is the
 *   right shape and is why the gate on the credit window was wrong.
 *
 *   NOBODY IS BIDDING. `marketAppetite` is how hard the average firm is
 *   leaning in, normalised so an ordinary market reads 1.0. A thin market both
 *   makes the pitch and makes it true.
 *
 * WHAT CLOSES THE DOOR is not either of those terms directly, and it is worth
 * being exact about it because a rule with no "no" in it is a rail: capital
 * arriving BIDS, bidding lifts prices, and a lifted price is a compressed cap
 * rate — so the spread the pitch was made on closes behind the fund that made
 * it. Checked over three unplayed centuries with the name supply removed as a
 * constraint: living firms run 30.7 · 29.0 · 29.7 · 34.0 · 34.3 · 37.3 · 36.0 ·
 * 36.3 · 37.0 · 37.3 by decade — it settles at about 37 by year 60 and stays
 * there for the next forty years, against a city whose floor area grows about a
 * third over the same span. It plateaus, it is not held up, and 51.7 firms had
 * ever existed by year 100 against no ceiling at all.
 */
function maybeNewFirm(s: GameState) {
  const c = s.econ.capRate;
  const cap = (c.office + c.retail + c.multifamily + c.industrial) / 4;
  const spread = cap - (s.econ.indexRate + RATE_SPREAD);
  if (spread <= 0) return;
  const opportunity = spread / Math.max(0.2, marketAppetite(s));
  if (rng(s) > Math.min(0.5, opportunity / RAISE_M)) return;
  const used = new Set((s.rivals ?? []).map((r) => r.name));
  const pool = NEW_FIRMS.filter((f) => !used.has(f.name));
  const f = pool.length ? pool[Math.floor(rng(s) * pool.length)] : coinFirm(s, used);
  if (!f) return;
  // A NEW FUND IS A NEW FUND. This used to scale the raise by aggregate street
  // AUM — "sized to the era" — which sounds right and is not: once the twelve
  // incumbents crossed half a billion between them, every firm founded after
  // that came out of the gate at up to $15M, above the cap the whole roster is
  // built to. A firm's first close is set by what a first-time sponsor can
  // raise, not by how rich the people who started forty years earlier have
  // become. They compound their way up like everybody else.
  const equity = Math.round(rrange(s, 4_000_000, 10_000_000));
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
  // Trimmed with the city's own rate: once the anonymous quota came down by
  // three quarters the street's own groundbreakings were most of the cranes
  // in town, and the point was fewer cranes, not different ones.
  // AND THE PRO FORMA. A developer does not break ground because the phase is
  // "expansion"; he breaks ground because the yield on cost clears what the
  // capital stack needs, and when it does not he sits on the dirt. This is the
  // same hurdle the anonymous quota reads — see market.devPencils — and wiring
  // the street to it is what makes a rate shock reach the skyline instead of
  // stopping at the one pro forma nobody on this street was reading.
  if (rng(s) >= 0.011 * BUILD_APPETITE[r.style] * phaseMult * ci * devPencils(s.econ)) return;

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
  let use = useForZone(rec.zoneDist, rec.demandScore, rng(s), s.econ);
  // Shops do not stack, and a corner that carries twenty floors does not get a
  // two-storey shop on it — it gets shops at grade with something above.
  if (use === "retail" && retailWantsMixed(rec)) use = "mixed";
  const lead = dominantOf(devMix(use));
  const farMax = farMaxFor(rec);
  const frac = Math.min(0.95, 0.4 + rng(s) * 0.45);
  let sf = Math.max(3000, Math.round((rec.lotArea * farMax * frac) / 100) * 100);
  let floors = Math.max(1, Math.round(sf / (rec.lotArea * 0.62)));
  // A named developer reads the same comps the anonymous city does: one
  // increment above the block's cornice datum, not the zoning envelope.
  const infill = cityInfillCap(s, parcels, rec, Math.min(1, s.month / 780));
  if (floors > infill) {
    floors = infill;
    sf = Math.max(3000, Math.round((rec.lotArea * 0.62 * floors) / 100) * 100);
  }
  const cap = MAX_FLOORS_BY_USE[use];
  if (cap !== undefined && floors > cap) {
    floors = cap;
    sf = Math.max(3000, Math.round((rec.lotArea * 0.62 * floors) / 100) * 100);
  }
  const cost = jobBudget(s, use, sf, floors);
  if (cost > (r.aum ?? 0) * 0.75 + r.cash * 4) return;
  const ltc = Math.max(0.4, Math.min(0.7, 0.7 * ci));
  // the dirt is already theirs, so only the build equity has to be in the bank
  if (r.cash < Math.round(cost * (1 - ltc) * 0.45) + Math.max(1_000_000, r.cash * 0.06)) return;
  const [bLo, bHi] = BUILD_MONTHS[lead];
  const months = Math.round(bLo + rng(s) * (bHi - bLo));
  const deliverM = s.month + months;
  if (!s.cityJobs) s.cityJobs = [];
  // A NAMED FIRM BUILDS THE SAME BUILDING THE CITY DOES — shops at grade where
  // the street carries them. Settled here and carried on the job so the
  // pipeline below and the delivery record cannot disagree.
  const prog = capRetail(withStreetRetail(devMix(use), floors, demandNow(s, rec)), floors);
  s.cityJobs.push({
    bbl, use, sf, floors, startM: s.month, deliverM, mix: prog,
    firmId: r.id, cost, spent: 0,
    equityLeft: Math.round(cost * (1 - ltc)), debt: 0,
    ratePct: +(s.econ.indexRate + CONSTR_SPREAD_R).toFixed(2),
    lender: pickConstructionDesk(s, bbl + "#" + s.month) ?? CONSTRUCTION_LENDER,
  });
  noteRecordPlan(s, parcels, bbl, lead, sf, floors, r.name);
  // into the delivery pipeline the day the hole is dug, exactly like the city's
  if (!s.econ.cohorts) s.econ.cohorts = { office: [], retail: [], multifamily: [], industrial: [] };
  for (const [u, share] of Object.entries(prog)) {
    const usf = Math.round(sf * (share as number));
    if (usf > 0) s.econ.cohorts[u as BuiltClass].push({ m: deliverM, sf: usf });
  }
  s.news.unshift({
    q: s.month, kind: "event",
    text: `${r.name} is building on their own land at ${rec.address} — ${(sf / 1000).toFixed(0)}k sf of ${use}, `
      + `$${(cost / 1e6).toFixed(1)}M. They have been sitting on that corner waiting for this market.`,
  });
}

// ---------------------------------------------------------------- the cliff
//
// A NON-RECOURSE MORTGAGE DOES NOT ACCELERATE BECAUSE A VALUER MARKED THE
// BUILDING DOWN.
//
// What this file used to do instead: `stressed = ltvNow > maxLtv + 0.05`, and
// thirty months later the firm was dead. That is a mark-to-market solvency
// test, and no commercial mortgage in the world contains one. A borrower who
// makes every payment on time does not default because an appraiser's opinion
// of the collateral changed, and a lender who accelerated on that basis would
// be sued and would lose. Measured on the old test over four fifty-year runs:
// 89 of 162 firms died, the median one aged 13.8 years, and the constant cohort
// of the dying was HEALTHY five years out at 0.39 leverage with nine buildings
// and money in the bank. What killed them was the city's own repricing — a
// fixed basket of the same buildings at the same grade fell 44% across the same
// window, which is the market, not the borrower.
//
// Leverage still has to bite, or the whole business becomes safe. It bites in
// life at the REFINANCING CLIFF, which is a DATE and not a running appraisal:
// the balloon lands, the new loan is sized against today's value and today's
// lender appetite, and a sponsor who cannot cover the gap between the old
// balance and the new proceeds has to find the difference or give the building
// up. CLAUDE.md names it in the list of things that make this business hard.
//
// WHAT MATURITY MACHINERY THE STREET HAD: none. `r.debt` is a single number
// with an amortisation share and no term at all, so nothing on this street has
// ever come due. This is the smallest honest version of one.

// THE LADDER IS DERIVED, NOT STORED, and this is the reason why.
//
// A rival deliberately carries no per-asset loan record — see the header of
// this file — and inventing one would mean two numbers that both claim to be
// what the firm owes. But an origination date is already known: `heldSince`
// records the month each deed arrived, and a mortgage is written at the
// closing. So a firm's balloons are its acquisition dates plus a term, which
// gives a real, staggered ladder for nothing and cannot drift away from the
// book.
//
// The three desks that write term paper on standing income property in this
// town are the hometown bank, the regional and the conduit; the terms come
// from their own sheets rather than being restated here. Which of the three
// wrote any particular file is not recorded anywhere in this engine, so it is
// drawn deterministically per building — stable across a save, staggered
// across a book, and honest about being an allocation rather than a fact.
const TERM_DESKS = ["harbor", "savings", "conduit"];

function hash32(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** The term of the paper on one building of one firm's, in months. */
function loanTermM(r: Rival, bbl: string): number {
  return productById(TERM_DESKS[hash32(r.id + "|" + bbl) % TERM_DESKS.length]).termM;
}

/**
 * WHEN THE PAPER ON THIS BUILDING WAS WRITTEN.
 *
 * `heldSince` when the deed moved inside the sim. The opening roster has no
 * such record — `initRivals` hands a firm nine buildings in month zero — and
 * dating all of them to month zero would land every balloon on the street in
 * the same month, which is an artefact of the setup and not a credit cycle. A
 * firm that opens the game owning nine buildings did not buy them all in
 * December: the opening book is spread back across the term it carries.
 */
function originM(r: Rival, bbl: string, term: number): number {
  const since = r.heldSince?.[bbl];
  if (since !== undefined) return since;
  return -(hash32(r.id + "~" + bbl) % term);
}

/**
 * WHICH DESK HOLDS THE PAPER ON ONE OF THEIR BUILDINGS.
 *
 * The engine does not know, and says so — the same admission
 * `chargeSponsorFailure` already makes about a dead firm's term debt, and
 * allocated by the same rule so there is one story about whose paper this is:
 * a bigger book holds more of this town's mortgages. Deterministic per
 * building so the desk that grants an extension is the desk that eats the loss
 * if the extension is refused.
 */
function deskFor(s: GameState, r: Rival, bbl: string): string {
  const live = (s.lenders ?? []).filter((l) => l.failedM === undefined);
  if (!live.length) return CONSTRUCTION_LENDER;
  const books = live.reduce((a, l) => a + l.book, 0);
  if (books <= 0) return live[0].name;
  let t = ((hash32(r.id + "@" + bbl) % 100_000) / 100_000) * books;
  for (const l of live) { t -= l.book; if (t <= 0) return l.name; }
  return live[live.length - 1].name;
}

/**
 * RESCUE EQUITY, AND WHY IT IS RECALLED DISTRIBUTIONS.
 *
 * A capital call is the single most common outcome of a real workout and this
 * street had no way to make one. It is also the thing that separates patient
 * old money from a merchant builder: when the balloon lands, a family office
 * writes a cheque and a builder who was paid out at his last delivery has
 * nobody left to ring.
 *
 * The well is what the vehicle has already returned to its investors, because
 * that is what an investor base will fund a protective call out of. It is not
 * a metaphor — RECALLABLE DISTRIBUTIONS are a standing provision in nearly
 * every limited partnership agreement in this business, normally capped at
 * something near 100% of what has been distributed during the investment
 * period, and this is exactly that clause. It needs no new bookkeeping because
 * `distributed` is already tracked, and it is self-limiting by construction: a
 * sponsor who has never returned a dollar cannot raise a rescue round, which
 * is true and is why the youngest, most levered shops should be the ones that
 * die rather than the ones that get bailed out.
 *
 * The share is a fact about the VEHICLE, not a dial. At the top are the ones
 * with a standing pool and a partnership agreement that lets them recall it —
 * committed funds and family capital. At the bottom are the ones with no
 * vehicle at all: a merchant builder syndicates each job and dissolves it at
 * the sale, so there is no fund to call.
 *
 * NOT MODELLED, AND IT MATTERS: a newly-raised fund's UNDRAWN commitment.
 * `initRivals` and `maybeNewFirm` hand a firm its entire raise as cash on day
 * one, so there is nothing behind it, and a young fund here is therefore more
 * fragile than a young fund in life. Fixing that needs a field on `Rival`.
 */
const RECALL: Record<RivalStyle, number> = {
  // it is their own money and always was; the point of the vehicle is to never
  // be a forced seller
  family: 1.0, owneruser: 1.0,
  // offshore capital defending a trophy: it comes, and it comes slowly
  foreign: 0.9,
  // closed-end funds with the recall clause written into the LPA
  opportunistic: 0.8, pe: 0.8, vulture: 0.75,
  // an open-ended institutional vehicle goes back to a board, which protects an
  // existing position but wants a paper on it first
  core: 0.7,
  // a listed company issues equity, which it can always do, never wants to, and
  // is punished for
  reit: 0.6,
  // a deal-by-deal sponsor rings the investors who happen to be in THAT deal,
  // and there is no fund behind them
  developer: 0.45,
  // built to sell: the investors were cashed out at the last delivery and the
  // partnership was wound up with them
  merchant: 0.25,
  // the partners are the principal and his brother-in-law
  slumlord: 0.2,
};

/** Ring the investors. Returns what actually arrived. */
function callCapital(r: Rival, want: number): number {
  if (want <= 0) return 0;
  const well = Math.floor(Math.max(0, r.distributed ?? 0) * RECALL[r.style]);
  const got = Math.min(Math.round(want), well);
  if (got < 100_000) return 0;   // nobody convenes a partnership for pocket money
  r.cash += got;
  // The money goes back where it came from. `distributed` becomes cash NET
  // returned to the partners, which is what it should always have meant, and
  // the well cannot be drawn twice.
  r.distributed = Math.round((r.distributed ?? 0) - got);
  return got;
}

/**
 * SELL THE ONE THAT COVERS THE HOLE, not a building drawn out of a hat.
 *
 * The old stress path picked `r.bbls[floor(rng * length)]` — a random asset,
 * every other month, at a receiver's discount, forever. A sponsor working out
 * of trouble does the opposite: he sells the SMALLEST thing that raises what
 * he needs, because everything he sells is a building he wanted to keep and
 * the core of the book is the reason the vehicle exists. Only when nothing on
 * the list covers it does he put up the biggest one.
 *
 * The price band is unchanged — a seller with a deadline gets a seller's price
 * — because the fault here was never what these buildings fetched, it was
 * which one went and how often.
 */
// What a sponsor under duress gets for a building, unchanged from the path this
// replaces. Written once because the decision reads its midpoint and the ask
// draws from it, and a hardcoded 0.78 beside a `rrange(0.68, 0.88)` is the same
// band written down twice.
const DURESS_BAND: [number, number] = [0.68, 0.88];
const DURESS_MID = (DURESS_BAND[0] + DURESS_BAND[1]) / 2;

function marketAssetToRaise(s: GameState, parcels: ParcelTable, r: Rival, need: number): boolean {
  const lev = (r.aum ?? 0) > 0 ? Math.min(1, Math.max(0, r.debt / (r.aum as number))) : r.targetLtv;
  let pick: { bbl: string; rec: ParcelRecord; net: number } | null = null;
  let biggest: { bbl: string; rec: ParcelRecord; net: number } | null = null;
  for (const bbl of r.bbls) {
    if (s.holdings[bbl] || s.listings.some((l) => l.bbl === bbl)) continue;
    const rec = resolveRec(parcels, s, bbl);
    if (!rec) continue;
    // What the sale actually puts in the account: the price, less the debt it
    // retires — the same rule `debtReleasedOnSale` applies at the closing, so
    // the decision and the settlement agree.
    const px = markAsset(s, r, rec).v * DURESS_MID;
    const net = px * (1 - lev);
    if (!biggest || net > biggest.net) biggest = { bbl, rec, net };
    if (net >= need && (!pick || net < pick.net)) pick = { bbl, rec, net };
  }
  const sell = pick ?? biggest;
  if (!sell) return false;
  const v = markAsset(s, r, sell.rec).v;
  const px = Math.round(v * rrange(s, ...DURESS_BAND));
  r.dumped = (r.dumped ?? 0) + 1;
  // The deed stays with them until somebody buys it — a firm selling under
  // pressure is still the owner, and that is the whole point of the trade.
  s.listings.push({ bbl: sell.bbl, ask: px, listedM: s.month, expiresM: s.month + 8, distress: true, sellerId: r.id });
  s.news.unshift({
    q: s.month, kind: "event",
    text: (r.dumped ?? 1) <= 1
      ? `${r.name} is selling. ${sell.rec.address} hits the tape at ${(px / 1e6).toFixed(2)}M — ${Math.round((1 - px / Math.max(1, v)) * 100)}% under appraisal. They are short of cash and the market knows it.`
      : `${r.name}, again: ${sell.rec.address} at ${(px / 1e6).toFixed(2)}M. That is their ${r.dumped === 2 ? "second" : r.dumped === 3 ? "third" : `${r.dumped}th`} building on the tape this stretch.`,
  });
  return true;
}

/**
 * HAND ONE BACK.
 *
 * The civilised exit, and the one thing a sponsor can always do that a forced
 * sale cannot: it needs no buyer, no marketing period and no cash. The keys go
 * to the desk that holds the paper, the loan goes with them, and because the
 * debt is non-recourse whatever the building is short by is the LENDER'S loss
 * — which is the entire economic content of non-recourse and was previously
 * something only the player could do (workout.deedInLieu).
 *
 * WHICH BUILDING: the one the market likes least. A sponsor keeps what he can
 * refinance and gives away what he cannot, so the choice is made on the ratio
 * of what a desk will lend against the asset today to what the asset is
 * marked at — the same `streetRefiProceeds` that decides the maturity itself,
 * asked of every building on the list.
 *
 * The building goes on the tape as the bank's, not the firm's: no `sellerId`,
 * because the firm no longer owns it and negotiating with them for it would be
 * negotiating with somebody who has nothing to sell.
 */
function deedInLieu(s: GameState, parcels: ParcelTable, r: Rival, why: string): boolean {
  const lev = (r.aum ?? 0) > 0 ? Math.max(0, r.debt / (r.aum as number)) : r.targetLtv;
  const st = STYLE[r.style];
  let worst: { bbl: string; rec: ParcelRecord; v: number; ratio: number } | null = null;
  for (const bbl of r.bbls) {
    if (s.holdings[bbl]) continue;
    const rec = resolveRec(parcels, s, bbl);
    if (!rec) continue;
    const { v, noi } = markAsset(s, r, rec);
    if (v <= 0) continue;
    const ratio = streetRefiProceeds(s, v, noi, st.maxLtv).principal / v;
    if (!worst || ratio < worst.ratio) worst = { bbl, rec, v, ratio };
  }
  if (!worst) return false;
  const desk = deskFor(s, r, worst.bbl);
  const owed = Math.min(r.debt, Math.round(worst.v * lev));

  r.bbls = r.bbls.filter((b) => b !== worst!.bbl);
  if (r.heldSince) delete r.heldSince[worst.bbl];
  r.debt = Math.max(0, r.debt - owed);
  // The book shrinks with it. Basis is aggregate, so it comes off by the share
  // this building was — the same estimate `gainsTax` makes on a sale.
  const basis = r.basis ?? 0;
  r.basis = Math.max(0, Math.round(basis - basis / Math.max(1, r.bbls.length + 1)));
  s.listings = s.listings.filter((l) => l.bbl !== worst!.bbl);
  // What the desk will get for it, which is what a receiver gets for anything:
  // the band this file already uses for a lender clearing a book.
  const ask = Math.round(worst.v * rrange(s, 0.72, 0.88) / 1000) * 1000;
  s.listings.push({
    bbl: worst.bbl, ask, listedM: s.month,
    expiresM: s.month + Math.round(rrange(s, 6, 12)), distress: true, receiverFor: desk,
  });
  chargeLenderLoss(s, desk, Math.max(0, owed - ask));
  s.news.unshift({
    q: s.month, kind: "warn",
    text: `${r.name} has handed ${worst.rec.address} back to ${desk}. ${why} `
      + `The paper was non-recourse, so the ${(Math.max(0, owed - ask) / 1e6).toFixed(2)}M it is short is the bank's problem, not theirs. `
      + `They still own ${r.bbls.length} building${r.bbls.length === 1 ? "" : "s"}.`,
  });
  return true;
}

/**
 * THE BALLOONS THAT LAND THIS MONTH.
 *
 * Every building whose paper comes due gets sized again from scratch, at the
 * same three desks and on the same three tests the player's own balloon walks
 * — `streetRefiProceeds`, which is `quote` with the two tests that are facts
 * about the PLAYER lifted off. So when a bank is impaired the street cannot
 * refinance either, which is the entire reason the banks were given books.
 *
 * The gap between what is owed and what the market will write is real money
 * and it is due now. In the order a sponsor actually works it: pay it, ask the
 * desk to extend, ring the investors, sell something, hand it back. Only the
 * last of those loses a building, and none of them is a failure — a firm that
 * shrinks at a maturity is a firm that survived one.
 */
function tickMaturities(s: GameState, parcels: ParcelTable, r: Rival, aum: number) {
  if (r.debt <= 0 || aum <= 0 || !r.bbls.length) return;
  const st = STYLE[r.style];
  // The mortgage on one asset is the leverage actually on the book — the same
  // proxy `debtReleasedOnSale` uses at a closing, for the same reason, so a
  // building's loan is one number rather than two.
  const lev = Math.max(0, r.debt / aum);
  for (const bbl of [...r.bbls]) {
    const term = loanTermM(r, bbl);
    const held = s.month - originM(r, bbl, term);
    if (held <= 0 || held % term !== 0) continue;
    const rec = resolveRec(parcels, s, bbl);
    if (!rec) continue;
    const { v, noi } = markAsset(s, r, rec);
    // A firm cannot owe more on one building than it owes altogether. That is
    // the only bound needed here — no cap on leverage, which would be a rail
    // rather than a fact, because a book marked below its debt is a real
    // condition and the whole point of this block is that it is survivable.
    const due = Math.min(r.debt, Math.round(v * lev));
    if (due <= 0) continue;
    const refi = streetRefiProceeds(s, v, noi, st.maxLtv);
    const gap = due - refi.principal;
    if (gap <= 0) continue;                       // rolled, and nobody hears about it

    // 1. WRITE THE CHEQUE. A balloon is paid before a reserve is kept.
    if (r.cash >= gap) { r.cash -= gap; r.debt = Math.max(0, r.debt - gap); continue; }

    // 2. ASK THE DESK. A bank with capital would far rather carry a performing
    //    loan than own a building; one that is impaired has a regulator
    //    reading the same balance sheet it is. That test is `deskWillExtend`
    //    and it is the same test the player's forbearance request runs.
    const desk = deskFor(s, r, bbl);
    if (deskWillExtend(s, desk)) {
      // Modification paper is not free, and the point the desk charges is the
      // point it charges the player — `extensionFeePct`, one answer for both
      // borrowers. It is capitalised, which is what a desk does when the
      // borrower plainly has no cash, and it is why an extended loan comes back
      // bigger than it went in.
      r.debt = Math.round(r.debt + due * extensionFeePct(s, desk));
      // The runway is what it is for: sell something and pay it down.
      if (r.cash < gap) marketAssetToRaise(s, parcels, r, gap - Math.max(0, r.cash));
      if (rng(s) < 0.25) {
        s.news.unshift({
          q: s.month, kind: "event",
          text: `${r.name} could not refinance ${rec.address} in full — ${desk} would write ${(refi.principal / 1e6).toFixed(1)}M against ${(due / 1e6).toFixed(1)}M outstanding, `
            + `bound by ${refi.binding}. The desk extended rather than take the keys. They are ${(gap / 1e6).toFixed(1)}M short and they have bought time, not a solution.`,
        });
      }
      continue;
    }

    // 3. RING THE INVESTORS.
    const got = callCapital(r, gap - Math.max(0, r.cash));
    if (got > 0 && r.cash >= gap) {
      r.cash -= gap;
      r.debt = Math.max(0, r.debt - gap);
      if (rng(s) < 0.4) {
        s.news.unshift({
          q: s.month, kind: "event",
          text: `${r.name} has called ${(got / 1e6).toFixed(1)}M from their partners to clear the balloon on ${rec.address}. `
            + `The money that went out over the years is going back in. That is what an investor base is FOR, and it is why the old houses outlast the clever ones.`,
        });
      }
      continue;
    }

    // 4. HAND IT BACK. No buyer needed, no cash needed, and the shortfall is
    //    the bank's — which is what non-recourse means.
    deedInLieu(s, parcels, r,
      `The balloon came due and nobody would refinance it: ${(refi.principal / 1e6).toFixed(1)}M against ${(due / 1e6).toFixed(1)}M outstanding.`);
    return;   // one workout at a time; the rest of the ladder is next month's problem
  }
}

export function tickRivals(s: GameState, parcels: ParcelTable) {
  if (!s.rivals?.length) return;
  const ci = Math.max(0.4, Math.min(1.25, s.econ.creditIdx ?? 1));
  const rate = s.econ.indexRate + RATE_SPREAD;
  maybeNewFirm(s);
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
        // KEEP THE DEED UNTIL IT CLOSES. This stripped the building out of the
        // firm's book one line BEFORE pushing the listing, so ownerOf returned
        // null and the negotiation fell through to an anonymous hash. Measured:
        // of 348 distress listings a run, five carried a name. The two moments
        // a rival is most interesting — under duress, and dead — were the exact
        // two where the game took their name off the ticket.
        if (s.holdings[bbl] || s.listings.some((l) => l.bbl === bbl)) continue;
        const rec = resolveRec(parcels, s, bbl);
        if (!rec) continue;
        const v = assetValue(rec, s.econ, initialCondition(rec));
        s.listings.push({
          // A receiver takes a haircut; a receiver does not give buildings
          // away. The bottom of this band is the bottom of the whole game's
          // discount range — see ASK_FLOOR in sim.ts.
          bbl, ask: Math.round(v * rrange(s, 0.72, 0.88) / 1000) * 1000,
          listedM: s.month, expiresM: s.month + Math.round(rrange(s, 6, 12)), distress: true,
          sellerId: r.id, receiverFor: r.name,
        });
      }
      continue;
    }
    const st = STYLE[r.style];
    tickAssetManagement(s, parcels, r);
    startOwnJob(s, parcels, r, ci);
    const { aum, noiYr } = markRival(s, parcels, r);
    r.aum = Math.round(aum);

    // --- the money -------------------------------------------------------
    // NOI in, interest and amortisation out. A firm this size amortises on a
    // thirty-year schedule; nobody gets pure interest-only forever.
    const interest = (r.debt * rate) / 100 / 12;
    const amort = r.debt > 0 ? (r.debt * AMORT_SHARE[r.style]) / (30 * 12) : 0;
    // Their dry powder sits in the same bank yours does, at the same dull one
    // per cent. It was earning nothing at all before, which meant every month a
    // firm spent waiting for a cycle cost it something the player was not
    // paying — and dry powder is a real position on this street.
    const onDeposit = r.cash > 0 ? (r.cash * CASH_APY) / 12 : 0;
    r.cash += Math.round(noiYr / 12 - interest - amort + onDeposit);
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

    // --- the refinancing cliff -------------------------------------------
    // Before anything is paid out, because a balloon landing this month is a
    // call on this month's cash and the partners are behind the bank.
    tickMaturities(s, parcels, r, aum);
    // Leverage as it stands after the maturities, which is what everything
    // below has to read — a firm that just paid down a balloon or handed a
    // building back is not the firm `markRival` marked at the top of the tick.
    const lev = aum > 0 ? r.debt / aum : r.debt > 0 ? 9 : 0;

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
    if (st.cashOut > 0 && ci > 1.02 && lev < st.maxLtv - 0.06 && rng(s) < 0.06 * st.cashOut) {
      const room = Math.round((st.maxLtv - 0.04 - lev) * aum);
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
    // THE CLOCK, and it is the loudest personality difference on this street.
    //
    // Trimming into strength is what every firm does. What a fund with a life
    // does INSTEAD is sell because the fund is five years old, and it will do
    // that into a bad market, at a bad price, because an internal rate of
    // return is a function of TIME and the deadline does not care what the
    // market is doing. A merchant builder is the same story on a shorter fuse:
    // the fee was in the delivery and a building he still owns at year four is
    // a mistake. That is what puts good assets on the tape in a downturn, and
    // it is why the patient money on the other side of these tables — the
    // family office, the owner-user, the offshore buyer, none of whom have a
    // clock at all — ends up owning the best of this city.
    const stH = STYLE[r.style];
    let forcedBbl = null;
    if (stH.holdM > 0 && !r.stressMs) {
      let oldest = -1;
      for (const bbl of r.bbls) {
        const since = r.heldSince?.[bbl] ?? r.bornM ?? 0;
        const held = s.month - since;
        if (held >= stH.holdM && held > oldest && !s.holdings[bbl] && !s.listings.some((l) => l.bbl === bbl)) {
          oldest = held; forcedBbl = bbl;
        }
      }
    }
    if (forcedBbl) {
      const rec = resolveRec(parcels, s, forcedBbl);
      if (rec) {
        const v = assetValue(rec, s.econ, assetGrade(r, rec));
        // A seller against a deadline does not get to hold out for a number.
        s.listings.push({
          bbl: forcedBbl,
          ask: Math.round(v * rrange(s, 0.94, 1.04) / 1000) * 1000,
          listedM: s.month, expiresM: s.month + Math.round(rrange(s, 9, 16)),
          sellerId: r.id,
        });
        if (rng(s) < 0.30) {
          s.news.unshift({
            q: s.month, kind: "deal",
            text: `${r.name} has put ${rec.address} on the market. `
              + (r.style === "merchant"
                ? "They build to sell; they were never going to keep it."
                : `The fund is ${Math.round((s.month - (r.heldSince?.[forcedBbl] ?? 0)) / 12)} years into this one and the clock has run out — `
                  + `they are selling into ${s.econ.phase === "recession" ? "a market that does not want it" : "this market"} because the mandate says so.`),
          });
        }
      }
    }
    if (r.bbls.length > 6 && !r.stressMs && rng(s) < (hot ? 0.055 : 0.012) * (r.style === "family" || r.style === "owneruser" || r.style === "foreign" ? 0.25 : 1)) {
      const bbl = r.bbls[Math.floor(rng(s) * r.bbls.length)];
      const rec = resolveRec(parcels, s, bbl);
      if (rec && !s.holdings[bbl] && !s.listings.some((l) => l.bbl === bbl)) {
        const v = assetValue(rec, s.econ, assetGrade(r, rec));
        // THE CORNER COMES BACK. If this is a building they took out from
        // under a live negotiation of yours, it does not hit the tape — they
        // ring you first, because a firm that knows you wanted it once knows
        // you are the shortest route to a clean close. This is the whole payoff
        // of losing a deal to somebody with a name.
        const beat = (s.beaten ?? []).find((b) => b.bbl === bbl && b.firmId === r.id);
        if (beat && !s.approaches[bbl]) {
          const ask = Math.round(v * rrange(s, 1.02, 1.16) / 1000) * 1000;
          s.approaches[bbl] = { q: s.month, refused: false, ask, inbound: true };
          s.news.unshift({
            q: s.month, kind: "deal",
            text: `${r.name} is letting go of ${rec.address} — the corner they came over the top of you for in ${monthLabel(beat.m)}. `
              + `They paid ${(beat.theirs / 1e6).toFixed(2)}M; they will take ${(ask / 1e6).toFixed(2)}M, and they are showing it to you before the tape.`,
          });
          continue;
        }
        // a willing seller asks a willing seller's price
        s.listings.push({
          bbl, ask: Math.round(v * rrange(s, 1.00, 1.14) / 1000) * 1000,
          listedM: s.month, expiresM: s.month + Math.round(rrange(s, 6, 12)),
        });
      }
    }

    // --- trouble ---------------------------------------------------------
    // ONE WAY TO DIE, AND IT IS THE ONLY ONE A LENDER CAN ACT ON: they stopped
    // paying. The mark-to-market test that used to sit here — `ltvNow >
    // maxLtv + 0.05` for thirty months and the firm was struck off — is not a
    // term in any mortgage. A borrower current on debt service does not
    // default because a valuer revised an opinion, and the measurement said
    // that is exactly what was happening: the dying cohort was at 0.39
    // leverage with money in the bank five years out and was killed by a 44%
    // fall in the whole city's marks. See the block above `TERM_DESKS`.
    //
    // What is left is the honest test and it is severe enough on its own: NOI
    // does not cover interest, the line has no room left on it, and nobody
    // will put more equity in. That is a firm that cannot pay, and the clock
    // that runs on it is the same statute and the same court calendar the
    // player's own default runs on — NOTICE_M to cure, FORECLOSE_M once they
    // have filed. There is not one foreclosure calendar for you and a
    // different invented one for them.
    // AND A FIRM WITH NOTHING LEFT TO SELL GOES ON THE SAME CLOCK, NOT OFF A
    // CLIFF.
    //
    // This used to strike a firm off the month its book emptied and its debt
    // exceeded its cash — no notice period, no cure, no missed payment. It was
    // written to close a real hole (a bookless firm escaped the old stress test
    // forever, because that test only ran while there were buildings to sell),
    // and it closed it by inventing a second way to die that the paragraph
    // above says does not exist.
    //
    // Measured, 6 seeds x 100 years with the world kept alive: 135 deaths, 75
    // through the notice-and-foreclose calendar and 60 — 44% — through that
    // line. THIRTY-THREE of those 60 had `stressMs === 0`: they had never
    // missed a payment. The route was direct, because deed-in-lieu fires while
    // a firm is current: 357 of 505 handbacks happened with cash at or above
    // zero, 105 of them on a firm holding exactly one building. Give the last
    // building back at a balloon and this line struck you off the same month.
    //
    // Swapping "your LTV got high" for "your book got small" is not what was
    // asked for, and the old test at least gave thirty months.
    //
    // A borrower with no collateral and money still owed is not dead. He is
    // unsecured, and unsecured debt is collected on a calendar: the same
    // NOTICE_M to cure and FORECLOSE_M to file that everyone else gets. With no
    // buildings there is no NOI, so interest and amortisation drain the account
    // every month (see the debt service above, which is charged whether or not
    // anything is standing) — the clock still runs out, and quickly. It is now
    // legible as a wind-up rather than a disappearance.
    // THE REVOLVER.
    //
    // A cash shortfall is not a failure while there is room on the book, and
    // no firm in this business has ever sold a building at sixty-eight cents
    // because it was forty thousand dollars short in March. It draws on its
    // line, up to its own covenant, and it deals with the problem when the
    // problem is a real one.
    //
    // Without this the stress path fired on `cash < 0` while a firm's LTV was
    // FALLING — a shop amortising itself into a squeeze was marked distressed,
    // fire-sold for thirty months and died solvent. Measured: twelve firms
    // failed per fifty-year run and the two styles that actually compete with
    // the player were extinct nine years in ten.
    if (r.cash < 0 && r.bbls.length) {
      const room = Math.round((st.maxLtv - 0.02) * aum) - r.debt;
      const draw = Math.min(Math.max(0, room), Math.round(-r.cash + aum * 0.004));
      if (draw > 0) { r.debt += draw; r.cash += draw; r.revolver = (r.revolver ?? 0) + draw; }
    }
    // A NEGATIVE BALANCE AFTER THE LINE IS A MISSED PAYMENT. Not a mark, not a
    // covenant — money that was owed this month and did not go out. That is
    // the only thing that starts a clock in this business.
    if (r.cash < 0) {
      r.stressMs = (r.stressMs ?? 0) + 1;
      // 1. RING THE INVESTORS FIRST, because a protective call is cheaper than
      //    anything else on this list and it is what actually happens. A
      //    sponsor with a record to trade on covers the arrears and a month or
      //    two of running, and does not sell a building over a bad quarter.
      const need = -r.cash + Math.round(aum * 0.004);
      const got = callCapital(r, need);
      if (got > 0 && r.cash >= 0 && rng(s) < 0.2) {
        s.news.unshift({
          q: s.month, kind: "event",
          text: `${r.name} has called ${(got / 1e6).toFixed(1)}M from their partners. They were not going to sell a building over a bad year, and they did not have to.`,
        });
      }
      // 2. SELL SOMETHING. The one that covers the hole, not one drawn out of a
      //    hat — see marketAssetToRaise for what the old random pick cost.
      if (r.cash < 0 && r.stressMs % 2 === 0 && r.bbls.length) {
        marketAssetToRaise(s, parcels, r, need);
      }
      // 3. HAND ONE BACK once the desks have filed. This is the move that stops
      //    the spiral: a forced sale at seventy-eight cents retires debt at par
      //    against a book marked at a hundred, so every one of them RAISED
      //    leverage and cut the income that was servicing it — the firm could
      //    only ever accelerate. Giving the keys back removes the asset AND the
      //    loan AND the interest on it in one move, and on non-recourse paper
      //    the shortfall stops being the borrower's problem at the door.
      if ((r.stressMs === NOTICE_M || r.stressMs === NOTICE_M * 2) && r.bbls.length) {
        deedInLieu(s, parcels, r, `They have missed ${r.stressMs} months of debt service and could not cure.`);
      }
      // 4. AND WHEN THE CALENDAR RUNS OUT, the desks stop taking assets one at
      //    a time and take the relationship. Same clock as the player's.
      if (r.stressMs > NOTICE_M + FORECLOSE_M) {
        r.failedM = s.month;
        chargeSponsorFailure(s, parcels, r);
        s.news.unshift({
          q: s.month, kind: "warn",
          text: r.bbls.length
            ? `${r.name} is finished — ${r.bbls.length} building${r.bbls.length === 1 ? "" : "s"} go to the lenders. `
              + `They have not made a payment in ${r.stressMs} months, the partners stopped answering and no desk would extend again. The receiver will be selling for years.`
            : `${r.name} is wound up. They handed back the last building months ago and went on paying interest on what was left until they could not — `
              + `${r.stressMs} months in arrears with nothing behind it, and no collateral for the receiver to take.`,
        });
      }
    } else if (r.stressMs) {
      r.stressMs = 0;
      r.dumped = 0;
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
/**
 * HOW MANY FIRMS COULD ACTUALLY CLOSE THIS, AT THIS PRICE, TODAY.
 *
 * Not how many would like to — how many pass the same two tests the player
 * passes: the equity is in the account with a working reserve left over, and
 * the debt is lendable against the book they already carry. This is the depth
 * of the bid, and it is the number that decides whether a discount survives
 * contact with the market.
 */
export function qualifiedBuyers(s: GameState, rec: ParcelRecord, price: number): number {
  const seller = ownerOf(s, rec.bbl);
  const ci = Math.max(0.4, Math.min(1.25, s.econ.creditIdx ?? 1));
  const loan = acquisitionLoan(s, rec, price);
  let n = 0;
  for (const r of livingRivals(s)) {
    if (r === seller) continue;
    const st = STYLE[r.style];
    if (st.classes && !st.classes.includes(rec.class)) continue;
    const equity = price - loan(r, ci);
    if (r.cash < equity + Math.max(500_000, r.cash * 0.05)) continue;
    const aumAfter = (r.aum ?? 0) + price;
    const debtAfter = r.debt + (price - equity);
    if (aumAfter > 0 && debtAfter / aumAfter > st.maxLtv) continue;
    n++;
  }
  return n;
}

/**
 * WHAT A DESK WILL ACTUALLY LEND THIS FIRM AGAINST THIS BUILDING, TODAY.
 *
 * The street used to borrow `price * min(targetLtv, maxLtv)` — a number out of
 * its own personality table, with no lender in the room at all. The player has
 * never been able to do that: every acquisition loan is sized on the advance
 * rate AND on coverage AND on debt yield, at a named desk with its own capital,
 * and is routinely smaller than the LTV alone would suggest. So an opportunistic
 * shop wrote itself 88% of the price of a building yielding 6.8% while paying
 * the index plus 190bps — debt service of about 7% of the asset against income
 * of 6.8%, structurally negative from the day of the closing, on paper no desk
 * in this engine would have written for anybody. That is not a risk appetite,
 * it is a credit market that only exists for one of the two borrowers, and it
 * is most of why the styles with committed rescue capital were the ones dying.
 *
 * The income underwritten is `inPlace`: the disclosed rent roll where the
 * building came to market with one, which is the same number the player's own
 * lender reads off the same offering memorandum. Measured across 7,284
 * rival-held buildings, the class model's estimate of a building's income runs
 * 45% above what a roll on it actually produces — 84.4% occupancy against
 * 72.6% — so underwriting the estimate is underwriting income nobody collects.
 *
 * Returned as a closure because the price and the roll are properties of the
 * DEAL and want computing once, while the covenant is a property of the FIRM.
 */
function acquisitionLoan(s: GameState, rec: ParcelRecord, price: number): (r: Rival, ci: number) => number {
  const noi = inPlace(rec, s, rec.bbl, price).noi;
  return (r, ci) => {
    const st = STYLE[r.style];
    // In a shut credit market the loan is smaller, so the cheque is bigger —
    // which is exactly why a downturn is when a disciplined buyer with cash
    // gets to name their price.
    const cap = Math.min(r.targetLtv, st.maxLtv) * (ci < 0.8 ? 0.82 : 1);
    return Math.min(price, streetRefiProceeds(s, price, noi, cap).principal);
  };
}

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
  const loan = acquisitionLoan(s, rec, price);
  const candidates = livingRivals(s).filter((r) => {
    if (r === seller) return false;
    const st = STYLE[r.style];
    if (st.classes && !st.classes.includes(rec.class)) return false;
    const equity = price - loan(r, ci);
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
  // WHO ACTUALLY WANTS IT, and the two terms below are what stop every deal
  // going to whoever has the most leverage.
  //
  // `contra` inverts the credit cycle for the firms that live on the other
  // side of it. Almost everyone bids harder when money is cheap; a vulture
  // bids hardest when money is GONE, which is the only reason a receiver's
  // book is contested in the year it comes to market. `distressBias` is the
  // same idea applied to the individual asset — a distressed listing is what
  // one firm exists for and what another's committee will not look at.
  const shut = 1 - (s.econ.creditIdx ?? 1);
  const isDistress = !!s.listings.find((l) => l.bbl === rec.bbl)?.distress;
  let best = candidates[0], bestW = -Infinity;
  for (const r of candidates) {
    const st = STYLE[r.style];
    const cyc = 1 + st.procyclical * ((s.econ.creditIdx ?? 1) - 1) + st.contra * shut;
    const w = st.appetite * Math.max(0.05, cyc)
      * (isDistress ? st.distressBias : 1) * (0.6 + rng(s) * 0.8);
    if (w > bestW) { bestW = w; best = r; }
  }
  if (seller) {
    seller.bbls = seller.bbls.filter((b) => b !== rec.bbl);
    // Same event, same rule — a firm selling to another firm and a firm selling
    // to Hartford both retire the loan that was on the building. See
    // debtReleasedOnSale.
    const relief = debtReleasedOnSale(seller, price);
    seller.debt -= relief;
    seller.cash += price - relief - gainsTax(seller, price);
  }
  const equity = Math.round(price - loan(best, ci));
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

/**
 * A BUILDING SOLD TO SOMEBODY WE DO NOT MODEL IS STILL SOLD.
 *
 * When a listing is absorbed and no modelled firm wants it, the buyer is an
 * out-of-town name and the trade goes on the comps sheet. It did not, until
 * now, come off the seller. The rival kept the deed, kept collecting the rent,
 * and re-listed the same building a few months later — so 20 Sloop Alley
 * "sold" eighty-three times in one century while Tidewater Development owned it
 * from the first month to the last. Eighty-three prints of a sale that never
 * happened, on a comps sheet that sets land value for the whole district.
 *
 * The seller side is the same accounting `rivalBuys` already does for a firm
 * selling to another firm: the deed goes, the debt against it is retired out of
 * the proceeds, the gain is taxed, and what is left is cash. The only
 * difference is that the buyer has no balance sheet here, because the buyer is
 * an insurance company in Hartford and we do not model Hartford. `aum` is not
 * adjusted because `tickRivals` re-marks it from the portfolio every month.
 *
 * Returns whether a modelled firm actually lost a building — false means the
 * listing was the street's own and no deed had to move.
 */
export function sellToOutsider(s: GameState, bbl: string, price: number): boolean {
  const seller = (s.rivals ?? []).find((r) => r.bbls.includes(bbl));
  if (!seller) return false;
  seller.bbls = seller.bbls.filter((b) => b !== bbl);
  const relief = debtReleasedOnSale(seller, price);
  seller.debt -= relief;
  seller.cash += price - relief - gainsTax(seller, price);
  return true;
}

/**
 * WHAT A SALE PAYS OFF is the loan that was on the building, not the loan the
 * firm wishes it had. Retiring `price * targetLtv` over-repays every firm that
 * is running below its target, and a firm that sells often ends up with no debt
 * at all — when the outsider sale started actually conveying the deed and
 * became the commonest way a building leaves a portfolio, aggregate firm debt
 * across the town fell from $1.26B to $108M by year 50, which is a market of
 * unlevered landlords and not a property market. Firms that could not borrow
 * stopped building, the city delivered 108 jobs instead of 128, and real office
 * rents rose 0.44pp a year faster for the whole fifty years on the resulting
 * shortage.
 *
 * The honest proxy for the mortgage on one asset is the leverage actually on
 * the book, so a sale leaves the firm at roughly the leverage it had. Target
 * LTV is the fallback only for a firm with nothing marked yet.
 */
function debtReleasedOnSale(r: Rival, price: number): number {
  const lev = (r.aum ?? 0) > 0
    ? Math.min(1, Math.max(0, r.debt / (r.aum as number)))
    : r.targetLtv;
  return Math.min(r.debt, Math.round(price * lev));
}

/** What a rival will take for a building of theirs, and why. */
export function rivalAsk(s: GameState, parcels: ParcelTable, r: Rival, bbl: string): { ask: number; note: string } {
  const rec = resolveRec(parcels, s, bbl);
  const v = rec ? assetValue(rec, s.econ, assetGrade(r, rec)) : 0;
  const { ltv } = markRival(s, parcels, r);
  // AND THEY QUOTE YOU, NOT A STRANGER. A principal who has closed with you
  // twice prices the certainty of closing with you a third time; one you have
  // insulted prices the memory of it; and one who took a corner out from under
  // you knows exactly how badly you wanted that block.
  const t = s.street?.[r.id];
  const known = t ? Math.min(0.05, 0.018 * t.deals) - Math.min(0.06, 0.03 * t.insults) : 0;
  const st = STYLE[r.style];
  if (r.stressMs && r.stressMs > 4) {
    return { ask: Math.round(v * rrange(s, 0.80, 0.95) * (1 - known)), note: `${r.name} needs the money — they are inside appraisal and they know you know.` };
  }
  if (ltv < st.maxLtv * 0.6 && r.style === "family") {
    return { ask: Math.round(v * rrange(s, 1.18, 1.45)), note: `${r.name} has owned it for two generations and does not need to sell. That is the number.` };
  }
  return {
    ask: Math.round(v * rrange(s, st.patience - 0.04, st.patience + 0.12) * (1 - known)),
    note: (t?.deals ?? 0) >= 2
      ? `${r.name} have made money with you ${t!.deals === 2 ? "twice" : `${t!.deals} times`}. The number is friendlier than it needs to be, and they know it.`
      : (t?.insults ?? 0) > 0
        ? `${r.name} have not forgotten the last number you put to them. It is priced in.`
        : `${r.name} will trade at the right price.`,
  };
}
