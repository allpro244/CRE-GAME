// BUILDING ONE FIRM'S JEV REQUEST FOR A DECISION PERIOD.
//
// The engine computes everything — which listings the firm can afford and is
// allowed to buy, what each yields against the firm's cost of debt, what a
// cash-out would do to its coverage, which schemes clear zoning and the
// lender's hurdle — and this file turns those numbers into bucketed phrases
// (src/ai/buckets.ts) inside the questions of src/ai/jevQuestions.ts. The
// candidate sets are pre-filtered by code, so Jev only ever chooses among
// actions the firm could actually take.
//
// Pure and read-only: built on a clone of the state, so asking never moves the
// world (test/jev.mjs holds that to a hash).
import type { ParcelRecord, ParcelTable } from "@/data/types";
import type { BuiltClass, DevUse, GameState } from "@/engine/types";
import { cloneState, START_YEAR } from "@/engine/types";
import {
  assetGrade, buildAppetite, duressNet, gradeOf, holdClockM, lineRoom, listingOpenTo, liveJobCap,
  markAsset, markRival, redevBasis, rivalCanClose, STYLE_OF, streetDebtRatePct,
} from "@/engine/rivals";
import { assetValue, inPlace, occupancy, resolveRec, zoneUseBar } from "@/engine/value";
import { cityCoverage, cityInfillCap, MAX_FLOORS_BY_USE, underwriteDevelopment } from "@/engine/dev";
import { devMix, dominantOf, farMaxFor } from "@/engine/proforma";
import { landPencils } from "@/engine/buybox";
import { productById } from "@/engine/debt";
import { NATURAL_VAC } from "@/engine/market";
import type { JevCtx } from "@/engine/jev";
import * as B from "./buckets";
import {
  CHARTERS, JEV_MODEL, QID, qBuildPick, qBuyFit, qBuyIncome, qBuyLocation, qBuyPick, qBuyTiming, qBuyValue,
  qClaim, qDistressPick, qRefi, qSell, type JevQuestion, type JevRequest, type Text,
} from "./jevQuestions";

/** How many candidates each decision point may carry (Choice allows 255; these keep state and cost small). */
export const JEV_CAPS = { buy: 10, sell: 10, sites: 4, distress: 12 } as const;
const USES: DevUse[] = ["office", "retail", "multifamily", "industrial", "mixed"];
const USE_WORD: Record<string, string> = { office: "offices", retail: "shops", multifamily: "apartments", industrial: "industrial", mixed: "mixed use", land: "vacant land" };

export interface BuiltJevRequest { request: JevRequest; ctx: JevCtx; firmId: string; m: number }

export function buildJevRequest(s0: GameState, parcels: ParcelTable, firmId: string): BuiltJevRequest {
  const s = cloneState(s0);
  const r = (s.rivals ?? []).find((x) => x.id === firmId);
  if (!r || !r.jev) throw new Error(`${firmId} is not a Jev-run firm`);
  const e = s.econ;
  const st = STYLE_OF(r.style);
  const mk = markRival(s, parcels, r);
  const aum = mk.aum;
  const lev = aum > 0 ? r.debt / aum : r.debt > 0 ? 9 : 0;
  const debtRate = streetDebtRatePct(s) / 100;
  const ci = Math.max(0.4, Math.min(1.25, e.creditIdx ?? 1));
  const jobs = (s.cityJobs ?? []).filter((j) => j.firmId === r.id && !j.orphaned);
  const capOf = (c: string) => ((e.capRate as Record<string, number>)[c] ?? 7) / 100;
  const vacOf = (c: string) => (e.cityVac as Record<string, number>)[c] ?? 0.08;
  const natOf = (c: string) => (NATURAL_VAC as Record<string, number>)[c] ?? 0.08;
  const yr = START_YEAR + Math.floor(s.month / 12);

  // The book by use, for fit and concentration.
  const byUse: Record<string, number> = {};
  for (const b of r.bbls) {
    const rec = resolveRec(parcels, s, b);
    if (rec) byUse[rec.class] = (byUse[rec.class] ?? 0) + markAsset(s, r, rec).v;
  }
  const mix = Object.entries(byUse).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${USE_WORD[k] ?? k} ${Math.round(v / Math.max(1, aum) * 100)}%`).join(", ") || "no buildings yet";

  const state = {
    firm_mandate: CHARTERS[r.jev.charter].mandate,
    firm: {
      name: r.name,
      buildings: r.bbls.length,
      book: `${B.money(aum)} of property; ${mix}`,
      leverage: B.leverage(lev),
      cash: B.money(r.cash),
      construction: jobs.length ? `${jobs.length} project${jobs.length === 1 ? "" : "s"} under construction` : "nothing under construction",
      payments: r.stressMs ? `behind on debt payments for ${r.stressMs} months` : "current on all debt payments",
    },
    market: {
      cycle: B.phase(e.phase),
      credit: B.credit(ci),
      debt_cost: `the firm borrows at ${(debtRate * 100).toFixed(1)}% a year (policy rate ${e.indexRate.toFixed(2)}% plus 1.9%)`,
      vacancy: Object.fromEntries(["office", "retail", "multifamily", "industrial"].map((c) => [c, B.vacancyVs(vacOf(c), natOf(c))])),
      cap_rates: Object.fromEntries(["office", "retail", "multifamily", "industrial"].map((c) => [c, `${(capOf(c) * 100).toFixed(1)}%`])),
    },
  };

  const questions: Record<string, JevQuestion> = {};
  const ctx: JevCtx = { buy: [], sell: [], refi: false, build: [], claim: false, distress: [] };

  // ---------------------------------------------------------------- BUY
  if (!r.stressMs) {
    type Cand = { li: GameState["listings"][number]; rec: ParcelRecord; rank: number; obj: Record<string, unknown>; line: string };
    const cands: Cand[] = [];
    for (const li of s.listings) {
      if (!listingOpenTo(s, r, li)) continue;
      const rec = resolveRec(parcels, s, li.bbl);
      if (!rec) continue;
      if (st.classes && !st.classes.includes(rec.class)) continue;       // outside the style's box
      if (!rivalCanClose(s, parcels, r, rec, li.ask)) continue;          // cannot fund it
      const land = rec.class === "land" || !rec.bldgArea;
      const seller = li.receiverFor ? `the receiver for ${li.receiverFor}` : li.sellerId
        ? `${(s.rivals ?? []).find((x) => x.id === li.sellerId)?.name ?? "a firm"}${li.reason ? ` (${li.reason.replace("-", " ")} sale)` : ""}`
        : `a private owner${li.reason ? ` (${li.reason.replace("-", " ")} sale)` : ""}`;
      const book = B.shareOf(li.ask, aum + li.ask, "the firm's book after buying");
      const sameUse = B.shareOf((byUse[rec.class] ?? 0) + li.ask, aum + li.ask, `the book in ${USE_WORD[rec.class] ?? rec.class}`);
      if (land) {
        const lp = landPencils(rec, e, li.ask);
        if (!lp.pencils) continue;                                         // dirt that does not pencil is not a candidate
        cands.push({ li, rec, rank: lp.builderPsf / Math.max(1, lp.askPsf) - 1 + 0.5, line: "",
          obj: {
            address: rec.address, use: "vacant land", size: `lot of ${Math.round(rec.lotArea).toLocaleString("en-US")} sf, zoned ${rec.zoneDist}`,
            price: B.priceVs(li.ask, lp.builderPsf * rec.lotArea, "what a builder could pay for it"),
            going_in_yield: "none: vacant land earns no rent until it is built on",
            occupancy: "vacant land", rent_roll: "no tenants", condition: "vacant land",
            location: B.location(rec.demandScore), submarket: "land for development",
            seller, sale_type: li.distress ? "distressed sale" : "ordinary sale", book_share: book, concentration: sameUse,
          } });
        continue;
      }
      const ip = inPlace(rec, s, li.bbl, li.ask);
      const y = li.ask > 0 ? ip.noi / li.ask : 0;
      const appraisal = assetValue(rec, e, gradeOf(s, rec));
      const age = rec.yearBuilt ? yr - rec.yearBuilt : undefined;
      cands.push({ li, rec, rank: y - debtRate, line: "",
        obj: {
          address: rec.address, use: USE_WORD[rec.class] ?? rec.class, size: B.size(rec.bldgArea),
          price: B.priceVs(li.ask, appraisal),
          going_in_yield: B.yieldVs(y, debtRate, "the firm's cost of debt"),
          yield_vs_market: B.yieldVs(y, capOf(rec.class), `the market cap rate for ${USE_WORD[rec.class] ?? rec.class}`),
          occupancy: B.occupancyVs(ip.occ, 1 - vacOf(rec.class)),
          rent_roll: ip.disclosed ? "disclosed by the seller" : "not disclosed; estimated from the market",
          condition: `${gradeOf(s, rec)}${age !== undefined ? `, built ${rec.yearBuilt} (${age} years old)` : ""}`,
          location: B.location(rec.demandScore),
          submarket: `${USE_WORD[rec.class] ?? rec.class} market is ${B.vacancyVs(vacOf(rec.class), natOf(rec.class))}`,
          seller, sale_type: li.distress ? "distressed sale" : "ordinary sale", book_share: book, concentration: sameUse,
        } });
    }
    cands.sort((a, b) => b.rank - a.rank || (a.li.bbl < b.li.bbl ? -1 : 1));
    const top = cands.slice(0, JEV_CAPS.buy);
    if (top.length) {
      const opts: Record<string, Text> = {};
      for (const c of top) {
        const o = c.obj as Record<string, string>;
        opts[c.li.bbl] = `${o.address}: ${o.use}, ${o.size}; price ${o.price}; yield ${o.going_in_yield}; ${o.occupancy}; ${o.location}`;
        questions[QID.buyScore("value", c.li.bbl)] = qBuyValue(c.obj);
        questions[QID.buyScore("location", c.li.bbl)] = qBuyLocation(c.obj);
        questions[QID.buyScore("income", c.li.bbl)] = qBuyIncome(c.obj);
        questions[QID.buyScore("fit", c.li.bbl)] = qBuyFit(c.obj);
        ctx.buy.push({ bbl: c.li.bbl, ask: c.li.ask });
      }
      questions[QID.buyPick] = qBuyPick(opts);
      questions[QID.buyTiming] = qBuyTiming();
    }
  }

  // ---------------------------------------------------------------- SELL
  if (!r.stressMs) {
    const holdM = holdClockM(r.style);
    const rows: { bbl: string; y: number; obj: Record<string, unknown> }[] = [];
    for (const b of r.bbls) {
      if (s.holdings[b] || s.listings.some((l) => l.bbl === b) || (s.cityJobs ?? []).some((j) => j.bbl === b)
        || (s.portfolios ?? []).some((p) => p.bbls.includes(b))) continue;
      const rec = resolveRec(parcels, s, b);
      if (!rec || rec.class === "land" || !rec.bldgArea) continue;
      const held = s.month - (r.heldSince?.[b] ?? r.bornM ?? 0);
      if (held < 12) continue;
      const a = markAsset(s, r, rec);
      const y = a.v > 0 ? a.noi / a.v : 0;
      rows.push({ bbl: b, y, obj: {
        address: rec.address, use: USE_WORD[rec.class] ?? rec.class, size: B.size(rec.bldgArea),
        held: B.heldFor(held), value: B.money(a.v),
        income_yield: B.yieldVs(y, capOf(rec.class), `the market cap rate for ${USE_WORD[rec.class] ?? rec.class}`),
        occupancy: B.occupancyVs(a.occ ?? occupancy(rec, e), 1 - vacOf(rec.class)),
        condition: assetGrade(r, rec), location: B.location(rec.demandScore),
        submarket: `${USE_WORD[rec.class] ?? rec.class} market is ${B.vacancyVs(vacOf(rec.class), natOf(rec.class))}`,
        book_share: B.shareOf(a.v, aum, "the firm's book"),
        hold_limit: holdM > 0 ? `the mandate's hold period ends ${B.monthsAway(holdM - held)}` : "the mandate sets no hold period",
      } });
    }
    rows.sort((a, b) => a.y - b.y || (a.bbl < b.bbl ? -1 : 1));
    for (const x of rows.slice(0, JEV_CAPS.sell)) {
      questions[QID.sell(x.bbl)] = qSell(x.obj);
      ctx.sell.push(x.bbl);
    }
  }

  // ---------------------------------------------------------------- REFI
  if (st.cashOut > 0 && ci > 1.02 && lev < st.maxLtv - 0.06 && !r.stressMs) {
    const room = Math.min(Math.round((st.maxLtv - 0.04 - lev) * aum), Math.max(0, lineRoom(s, r, aum, mk.noiYr, mk.landV)));
    if (room > 1_000_000) {
      const after = r.debt + room;
      const minCover = productById("savings").uwDscr;
      questions[QID.refi] = qRefi({
        new_money: B.money(room),
        leverage_now: B.leverage(lev),
        leverage_after: B.leverage(after / Math.max(1, aum)),
        interest_coverage_after: B.dscrVs(mk.noiYr / Math.max(1, after * debtRate), minCover),
        rate: `${(debtRate * 100).toFixed(1)}% a year on the whole balance`,
      });
      ctx.refi = true;
    }
  }

  // ---------------------------------------------------------------- BUILD
  if (jobs.length < liveJobCap(r.style) && buildAppetite(r.style) > 0) {
    const opts: Record<string, Text> = {};
    let sites = 0;
    const siteList = [...r.bbls].map((b) => ({ b, rec: resolveRec(parcels, s, b) }))
      .filter((x): x is { b: string; rec: ParcelRecord } => !!x.rec)
      .sort((a, b) => Number(b.rec.class === "land") - Number(a.rec.class === "land") || b.rec.demandScore - a.rec.demandScore || (a.b < b.b ? -1 : 1));
    for (const { b, rec } of siteList) {
      if (sites >= JEV_CAPS.sites) break;
      if ((s.cityJobs ?? []).some((j) => j.bbl === b) || s.developments[b] || s.holdings[b] || s.listings.some((l) => l.bbl === b)) continue;
      if (rec.lotArea < 2500) continue;
      const land = rec.class === "land" || !rec.bldgArea;
      if (!land) {
        const g = assetGrade(r, rec);
        if ((rec.yearBuilt ? yr - rec.yearBuilt : 99) < 35 || (g !== "worn" && g !== "obsolete")) continue;
      }
      let any = false;
      for (const use of USES) {
        const lead = dominantOf(devMix(use)) as BuiltClass;
        if ((e.startOwed?.[lead] ?? 0) <= 0) continue;
        // The plate every other autonomous start draws — the use's own
        // coverage limit (cityCoverage), not a flat 0.62 — and the one height
        // rule (cityInfillCap).
        const plate = cityCoverage(use);
        const envelope = Math.max(1, Math.floor(farMaxFor(rec) / plate));
        const floors = Math.max(1, Math.min(envelope, cityInfillCap(s, parcels, rec, lead), MAX_FLOORS_BY_USE[use] ?? Infinity));
        if (zoneUseBar(rec, use, e, use === "mixed" ? devMix(use) : undefined, floors)) continue;
        const uw = underwriteDevelopment(s, parcels, b, use, floors, plate, land ? undefined : redevBasis(s, r, rec));
        if (!uw?.clears) continue;
        const plan = uw.plan;
        if (!land && plan.sf < rec.bldgArea * 1.12) continue;
        const dayOne = Math.round(plan.equity * 0.40);
        if (r.cash < dayOne + Math.max(400_000, r.cash * 0.03) || plan.costTotal > aum * 0.9 + r.cash * 5) continue;
        const id = `${b}:${use}`;
        opts[id] = `${rec.address}: ${land ? "build" : "tear down and rebuild"} ${plan.floors} floors of ${USE_WORD[use] ?? use} (${B.size(plan.sf)}), `
          + `cost ${B.money(plan.costTotal)}, ${plan.months} months to deliver; ${B.marginOnCost(plan.yieldOnCost, plan.requiredYield)}; `
          + `${B.location(rec.demandScore)}; ${USE_WORD[lead] ?? lead} market is ${B.vacancyVs(vacOf(lead), natOf(lead))}; `
          + `day-one equity: the firm ${B.cashVs(r.cash, dayOne)}`;
        ctx.build.push({ id, bbl: b, use, floors: plan.floors });
        any = true;
      }
      if (any) sites++;
    }
    if (ctx.build.length) questions[QID.buildPick] = qBuildPick(opts);
  }

  // ---------------------------------------------------------------- CLAIM
  if (buildAppetite(r.style) > 0) {
    const waiting = (["office", "retail", "multifamily", "industrial"] as BuiltClass[])
      .filter((c) => (e.startOwed?.[c] ?? 0) > 0).map((c) => USE_WORD[c]);
    questions[QID.claim] = qClaim({
      projects_building: `${jobs.length} of at most ${liveJobCap(r.style)}`,
      cash: B.money(r.cash),
      demand_for_new_space: waiting.length ? `tenants are waiting for new ${waiting.join(", ")}` : "no use has tenants waiting for new space",
    });
    ctx.claim = true;
  }

  // ---------------------------------------------------------------- DISTRESS
  if (r.cash < 0 || (r.stressMs ?? 0) > 0) {
    const opts: Record<string, Text> = {};
    const rows = r.bbls.filter((b) => !s.holdings[b] && !s.listings.some((l) => l.bbl === b))
      .map((b) => ({ b, net: duressNet(s, parcels, r, b), rec: resolveRec(parcels, s, b) }))
      .filter((x) => x.rec && x.net > 0).sort((a, b) => b.net - a.net || (a.b < b.b ? -1 : 1)).slice(0, JEV_CAPS.distress);
    for (const x of rows) {
      const rec = x.rec!;
      const a = markAsset(s, r, rec);
      opts[x.b] = `${rec.address}: ${USE_WORD[rec.class] ?? rec.class}; a forced sale nets about ${B.money(x.net)} after debt and tax; `
        + `${B.location(rec.demandScore)}; income ${B.yieldVs(a.v > 0 ? a.noi / a.v : 0, capOf(rec.class), "the market cap rate")}`;
      ctx.distress.push(x.b);
    }
    if (ctx.distress.length >= 2) questions[QID.distressPick] = qDistressPick(opts, B.money(Math.max(0, -r.cash)));
    else ctx.distress = [];
  }

  return { request: { state, model: JEV_MODEL, questions }, ctx, firmId, m: s0.month };
}
