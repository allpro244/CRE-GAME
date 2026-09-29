// FIRMS RUN BY AN OUTSIDE AI.
//
// The owner's ask: "let me plug in my API and let them run the AIs". This file
// is the engine half of that, and it is deliberately small, because the rule
// it lives under is the one the rest of this codebase lives under: there is
// one economy. An AI firm is an ordinary `Rival` with `aiControlled` set. It
// buys through `rivalBuys` (the same lender sizing, line draw, closing cost,
// comp print and deed transfer every street purchase goes through), it sells
// by putting a listing on the same tape the absorption loop works, it builds
// through the same `underwriteDevelopment` hurdle and `breakGround` the
// scripted developers use, and it borrows against the same `streetRefiProceeds`
// and `lineRoom` walls. Nothing here invents a price.
//
// Three pure functions are the whole interface:
//
//   aiBrief(s, parcels, firmId)            → a compact JSON observation
//   applyAiOrders(s, parcels, firmId, …)   → a new state + one verdict per order
//   createAiFirms / convertToAi            → put AI firms on the street
//
// DETERMINISM. Nothing in this file draws on the RNG — not the shared stream,
// not a named channel. Given the same state and the same orders, the result is
// bit-identical. A run with no AI firm never calls any of it, and the few lines
// it needed elsewhere (livingRivals, the tick's scripted branches) are guarded
// on `aiControlled`, so a run without AI firms is the run it always was.
// test/ai-firms.mjs holds that to a state hash.
import type { ParcelRecord, ParcelTable } from "@/data/types";
import type { BuiltClass, DevUse, GameState, Rival } from "./types";
import { cloneState, monthLabel } from "./types";
import {
  aiRivals, assetGrade, breakGround, clearRivalClaims, gradeOf, lineRoom, markAsset, markRival,
  ownerOf, rivalBuys, STYLE_OF,
} from "./rivals";
import { assetValue, inPlace, landValue, resolveRec, zoneUseBar } from "./value";
import { cityInfillCap, MAX_FLOORS_BY_USE, underwriteDevelopment } from "./dev";
import { devMix, dominantOf, farMaxFor } from "./proforma";
import { conveyedValue } from "./leasing";
import { streetRefiProceeds } from "./debt";
import { landPencils } from "./buybox";
import { isCivicLand } from "./demand";
import { rivalEquity } from "./standing";
import { money } from "./money";
import { aiBook, aiSnap, type AiOrderResult, type AiTurn } from "./aibooks";

export type { AiOrderResult, AiTurn, AiBookEntry } from "./aibooks";

/** The chassis an AI firm runs on: operating care, amortisation and leverage ceiling of a private-equity shop. */
export const AI_STYLE = "pe" as const;
/** Leverage an AI order may ask for. The PE chassis's own covenant ceiling. */
export const AI_MAX_LEVERAGE = 0.75;
/** Orders read per turn; the rest are refused. A guard on a runaway reply, not an economic rule. */
export const AI_MAX_ORDERS = 12;
/** Brief size ceiling in characters of JSON (~6k tokens) — test/ai-firms.mjs holds it. */
export const AI_BRIEF_CAP = 24_000;
/**
 * The most an AI firm may ask over the building's conveyed value. The tape's
 * absorption hazard was written for asks near value (every scripted ask sits
 * inside 0.8-1.14x): it never falls below a floor however high the ask, so an
 * ask at ten times value would eventually clear. That is not a market, it is a
 * hole — and no scripted seller could reach it. A guard, not a price.
 */
export const AI_MAX_ASK_OVER_VALUE = 1.3;
/** Refinance cost: points and legal on the new money, the order of the player's own points. */
const REFI_COST = 0.01;
const TAPE_CAP = 25;
const LAND_CAP = 15;
const SITE_CAP = 6;

const USES: DevUse[] = ["office", "retail", "multifamily", "industrial", "mixed"];

// ------------------------------------------------------------------ orders

export type AiOrder =
  | { action: "buy"; bbl: string; maxPrice: number; leverage?: number }
  | { action: "sell"; bbl: string; minPrice?: number }
  | { action: "reprice"; bbl: string; ask: number }
  | { action: "withdraw"; bbl: string }
  | { action: "refinance"; bbl: string }
  | { action: "paydown"; amount: number }
  | { action: "develop"; bbl: string; use: DevUse; floors: number }
  | { action: "hold" };

/**
 * THE ACTION MENU, as JSON Schema — shipped inside every brief so a model
 * never has to be told the protocol twice, and read by `validateOrder` so the
 * menu and the validator cannot disagree.
 */
export const AI_ACTIONS = {
  buy: {
    description: "Buy a listing off the tape at its ask. Refused if the ask is over maxPrice, or if your cash + credit line cannot fund equity + 2% closing + a working reserve. The loan is sized by the town's lenders (coverage, debt yield, advance rate) and capped at your leverage.",
    schema: { type: "object", required: ["action", "bbl", "maxPrice"], properties: {
      action: { const: "buy" }, bbl: { type: "string" }, maxPrice: { type: "number", exclusiveMinimum: 0 },
      leverage: { type: "number", minimum: 0, maximum: AI_MAX_LEVERAGE, default: 0.6 } } },
  },
  sell: {
    description: `List a building you own on the tape. Ask = minPrice (default: its appraised conveyed value). Asks above ${AI_MAX_ASK_OVER_VALUE}x appraisal are refused. It sells when a buyer takes it (months, not days); gains are taxed at 25% and the building's share of your debt is retired from proceeds.`,
    schema: { type: "object", required: ["action", "bbl"], properties: {
      action: { const: "sell" }, bbl: { type: "string" }, minPrice: { type: "number", exclusiveMinimum: 0 } } },
  },
  reprice: {
    description: "Change the ask on one of your live listings.",
    schema: { type: "object", required: ["action", "bbl", "ask"], properties: {
      action: { const: "reprice" }, bbl: { type: "string" }, ask: { type: "number", exclusiveMinimum: 0 } } },
  },
  withdraw: {
    description: "Take one of your listings off the tape.",
    schema: { type: "object", required: ["action", "bbl"], properties: { action: { const: "withdraw" }, bbl: { type: "string" } } },
  },
  refinance: {
    description: `Cash-out refinance against one income building: new money = what the lenders will size on it less its share of your debt, capped by your credit line room. Costs ${REFI_COST * 100}% of the new money. Refused under $250k.`,
    schema: { type: "object", required: ["action", "bbl"], properties: { action: { const: "refinance" }, bbl: { type: "string" } } },
  },
  paydown: {
    description: "Repay debt from cash.",
    schema: { type: "object", required: ["action", "amount"], properties: { action: { const: "paydown" }, amount: { type: "number", exclusiveMinimum: 0 } } },
  },
  develop: {
    description: "Break ground on a lot you own (vacant land, or a worn building you will demolish for at least 12% more floor area). The use must be permitted by zoning, floors must be within the zoning envelope and the block's cornice (see sites[]), the pro forma must clear the town's required yield with a construction lender open, and there must be tenant demand waiting for that class. 40% of sponsor equity is paid at groundbreak; the rest is drawn monthly.",
    schema: { type: "object", required: ["action", "bbl", "use", "floors"], properties: {
      action: { const: "develop" }, bbl: { type: "string" }, use: { enum: USES }, floors: { type: "integer", minimum: 1 } } },
  },
  hold: {
    description: "Do nothing this quarter.",
    schema: { type: "object", required: ["action"], properties: { action: { const: "hold" } } },
  },
} as const;

/** Parse one untrusted order into a typed one, or say why not. */
export function validateOrder(o: unknown): { order?: AiOrder; why?: string } {
  if (!o || typeof o !== "object") return { why: "An order must be a JSON object." };
  const x = o as Record<string, unknown>;
  const a = typeof x.action === "string" ? x.action.toLowerCase().trim() : "";
  const str = (k: string) => (typeof x[k] === "string" && (x[k] as string).length > 0 && (x[k] as string).length < 64 ? x[k] as string : undefined);
  const num = (k: string) => (typeof x[k] === "number" && Number.isFinite(x[k]) ? x[k] as number
    : typeof x[k] === "string" && x[k] !== "" && Number.isFinite(Number(x[k])) ? Number(x[k]) : undefined);
  switch (a) {
    case "hold": return { order: { action: "hold" } };
    case "buy": {
      const bbl = str("bbl"), maxPrice = num("maxPrice"), leverage = num("leverage");
      if (!bbl) return { why: "buy needs a bbl." };
      if (!(maxPrice !== undefined && maxPrice > 0)) return { why: "buy needs a positive maxPrice." };
      if (leverage !== undefined && !(leverage >= 0 && leverage <= AI_MAX_LEVERAGE)) return { why: `leverage must be between 0 and ${AI_MAX_LEVERAGE}.` };
      return { order: { action: "buy", bbl, maxPrice, leverage } };
    }
    case "sell": {
      const bbl = str("bbl"), minPrice = num("minPrice");
      if (!bbl) return { why: "sell needs a bbl." };
      if (minPrice !== undefined && !(minPrice > 0)) return { why: "minPrice must be positive." };
      return { order: { action: "sell", bbl, minPrice } };
    }
    case "reprice": {
      const bbl = str("bbl"), ask = num("ask");
      if (!bbl || !(ask !== undefined && ask > 0)) return { why: "reprice needs a bbl and a positive ask." };
      return { order: { action: "reprice", bbl, ask } };
    }
    case "withdraw": {
      const bbl = str("bbl");
      return bbl ? { order: { action: "withdraw", bbl } } : { why: "withdraw needs a bbl." };
    }
    case "refinance": {
      const bbl = str("bbl");
      return bbl ? { order: { action: "refinance", bbl } } : { why: "refinance needs a bbl." };
    }
    case "paydown": {
      const amount = num("amount");
      return amount !== undefined && amount > 0 ? { order: { action: "paydown", amount } } : { why: "paydown needs a positive amount." };
    }
    case "develop": {
      const bbl = str("bbl"), floors = num("floors");
      const use = (typeof x.use === "string" ? x.use.toLowerCase() : "") as DevUse;
      if (!bbl) return { why: "develop needs a bbl." };
      if (!USES.includes(use)) return { why: `use must be one of ${USES.join(", ")}.` };
      if (!(floors !== undefined && floors >= 1 && Number.isInteger(floors))) return { why: "floors must be a whole number, at least 1." };
      return { order: { action: "develop", bbl, use, floors } };
    }
    default: return { why: `Unknown action "${String(x.action)}". Actions: ${Object.keys(AI_ACTIONS).join(", ")}.` };
  }
}

// ------------------------------------------------------------------ creating

export interface AiFirmSpec { name: string; provider: string; model?: string; cash?: number }

const slug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "firm";

/**
 * NEW AI FIRMS, with money and no buildings — a first close, the way a new
 * fund arrives on this street. Every firm gets the same cheque unless its spec
 * says otherwise, so a match is a comparison of decisions, not of endowments.
 * Returns a new state.
 */
export function createAiFirms(s0: GameState, specs: AiFirmSpec[], cash0 = 25_000_000): GameState {
  const s = cloneState(s0);
  s.rivals ??= [];
  const used = new Set(s.rivals.map((r) => r.name));
  for (const [i, sp] of specs.entries()) {
    let name = (sp.name || `AI Firm ${i + 1}`).trim().slice(0, 48);
    while (used.has(name)) name += " II";
    used.add(name);
    let id = `ai:${slug(name)}`;
    while (s.rivals.some((r) => r.id === id)) id += "x";
    s.rivals.push({
      id, name, style: AI_STYLE,
      cash: Math.round(sp.cash ?? cash0), debt: 0, bbls: [],
      targetLtv: 0.6, bornM: s.month, basis: 0,
      aiControlled: { provider: String(sp.provider || "api").slice(0, 40), model: sp.model?.slice(0, 60), sinceM: s.month },
    });
    s.news.unshift({ q: s.month, kind: "info", text: `${name} opens its doors with ${money(Math.round(sp.cash ?? cash0))} of first-close capital. Its decisions are made by ${sp.provider}${sp.model ? ` (${sp.model})` : ""}.` });
  }
  return s;
}

/** Hand an existing street firm to an outside AI. Its principal steps back — the model runs it now. */
export function convertToAi(s0: GameState, firmId: string, provider: string, model?: string): GameState {
  const s = cloneState(s0);
  const r = (s.rivals ?? []).find((x) => x.id === firmId && x.failedM === undefined);
  if (!r) return s;
  r.aiControlled = { provider: provider.slice(0, 40), model: model?.slice(0, 60), sinceM: s.month };
  if (s.rivalPrincipals?.[firmId]) delete s.rivalPrincipals[firmId];
  return s;
}

// ------------------------------------------------------------------ the brief

const r0 = (n: number) => Math.round(n);
const pct = (n: number) => Math.round(n * 1000) / 10;

function sellerOf(s: GameState, li: GameState["listings"][number]): string {
  if (li.receiverFor) return `receiver for ${li.receiverFor}`;
  const o = li.sellerId ? (s.rivals ?? []).find((r) => r.id === li.sellerId) : null;
  if (o) return `${o.name} (${o.aiControlled ? "AI" : o.style}${li.reason ? `, ${li.reason}` : ""})`;
  return li.reason ?? "private owner";
}

/** Can this firm buy this listing at all — before any money question. */
function listingOpen(s: GameState, li: GameState["listings"][number], firmId: string): string | null {
  if (li.earlyUntilM !== undefined && s.month < li.earlyUntilM) return "That listing is a private first look for another buyer.";
  if (s.talks?.[li.bbl]?.agreed) return "That building is under contract to another buyer.";
  if (li.halfBuilt || (s.cityJobs ?? []).some((j) => j.bbl === li.bbl)) return "That is a stalled construction site; it is not offered as a finished building.";
  if (s.holdings[li.bbl]) return "That building belongs to the player.";
  if (li.sellerId === firmId || ownerOf(s, li.bbl)?.id === firmId) return "You already own that building.";
  if ((s.portfolios ?? []).some((p) => p.bbls.includes(li.bbl))) return "That building is inside a portfolio package.";
  if (isCivicLand(s, li.bbl)) return "That lot is civic land.";
  return null;
}

export interface AiBrief {
  protocol: "broadway-wall-ai/1";
  date: string; month: number;
  firm: Record<string, unknown>;
  market: Record<string, unknown>;
  holdings: Record<string, unknown>[];
  sites: Record<string, unknown>[];
  tape: Record<string, unknown>[];
  land: Record<string, unknown>[];
  /** Lots on the tape in all, penciling or not — `land` shows only those that pencil. */
  landListed: number;
  street: Record<string, unknown>[];
  news: string[];
  lastTurn?: { m: number; results: { order: unknown; ok: boolean; reason: string }[] };
  actions: typeof AI_ACTIONS;
  reply: string;
}

/**
 * WHAT ONE AI FIRM CAN SEE, as compact JSON. It is what a principal on this
 * street can see — their own book, the tape, the rates, the leaderboard, the
 * paper — and nothing a street firm could not know (no hidden rent rolls, no
 * RNG state, no other firm's orders). Built on a clone, so reading never moves
 * the world.
 */
export function aiBrief(s0: GameState, parcels: ParcelTable, firmId: string): AiBrief {
  const s = cloneState(s0);
  const r = (s.rivals ?? []).find((x) => x.id === firmId);
  if (!r) throw new Error(`No firm ${firmId}`);
  const e = s.econ;
  const mk = markRival(s, parcels, r);
  const room = Math.max(0, lineRoom(s, r, mk.aum, mk.noiYr, mk.landV));
  const jobs = (s.cityJobs ?? []).filter((j) => j.firmId === r.id && !j.orphaned);

  const holdings: Record<string, unknown>[] = [];
  const sites: Record<string, unknown>[] = [];
  for (const bbl of r.bbls) {
    const rec = resolveRec(parcels, s, bbl);
    if (!rec) continue;
    const a = markAsset(s, r, rec);
    const loan = s.cityLoans?.[bbl];
    const li = s.listings.find((l) => l.bbl === bbl);
    const job = jobs.find((j) => j.bbl === bbl);
    const land = rec.class === "land" || !rec.bldgArea;
    holdings.push({
      bbl, address: rec.address, class: rec.class, sf: rec.bldgArea, lotSf: rec.lotArea,
      built: rec.yearBuilt || undefined, grade: assetGrade(r, rec),
      occ: land ? undefined : pct(a.occ ?? 0), noi: r0(a.noi), value: r0(a.v),
      // Rival debt is one number; the public mortgage record allocates it by building.
      loan: loan ? { balance: loan.balance, ratePct: loan.ratePct, maturity: monthLabel(loan.maturityM) } : undefined,
      listed: li ? { ask: li.ask, since: monthLabel(li.listedM) } : undefined,
      building: job ? { use: job.use, sf: job.sf, delivers: monthLabel(job.deliverM) } : undefined,
    });
    // A lot you could build on: vacant, or worn stock with floor area to gain.
    if (job || li || rec.lotArea < 2500 || sites.length >= SITE_CAP) continue;
    const grade = assetGrade(r, rec);
    if (!land && grade !== "worn" && grade !== "obsolete") continue;
    const envelope = Math.max(1, Math.floor(farMaxFor(rec) / 0.62));
    const options: Record<string, unknown>[] = [];
    for (const use of USES) {
      const lead = dominantOf(devMix(use));
      const cornice = cityInfillCap(s, parcels, rec, Math.min(1, s.month / 780), lead);
      const cap = MAX_FLOORS_BY_USE[use];
      const floors = Math.max(1, Math.min(envelope, cornice, cap ?? Infinity));
      const bar = zoneUseBar(rec, use, e, use === "mixed" ? devMix(use) : undefined, floors);
      if (bar) continue;
      const uw = underwriteDevelopment(s, parcels, bbl, use, floors, 0.62, land ? undefined : redevBasis(s, r, rec));
      options.push({
        use, maxFloors: floors,
        pencils: !!uw?.clears,
        yieldOnCost: uw ? +uw.plan.yieldOnCost.toFixed(2) : undefined,
        requiredYield: uw ? +uw.plan.requiredYield.toFixed(2) : undefined,
        cost: uw ? r0(uw.plan.costTotal) : undefined,
        demandWaiting: (e.startOwed?.[lead] ?? 0) > 0,
      });
    }
    sites.push({ bbl, zone: rec.zoneDist, lotSf: rec.lotArea, standingSf: rec.bldgArea || 0, options });
  }

  type Row = { y: number; row: Record<string, unknown> };
  const bldgs: Row[] = [];
  const lots: Row[] = [];
  let landSeen = 0;
  for (const li of s.listings) {
    if (listingOpen(s, li, r.id)) continue;
    const rec = resolveRec(parcels, s, li.bbl);
    if (!rec) continue;
    if (rec.class === "land" || !rec.bldgArea) {
      landSeen++;
      const lp = landPencils(rec, e, li.ask);
      if (!lp.pencils) continue;
      lots.push({ y: lp.builderPsf / Math.max(1, lp.askPsf), row: {
        bbl: li.bbl, address: rec.address, zone: rec.zoneDist, lotSf: rec.lotArea, ask: li.ask,
        askPsf: Math.round(lp.askPsf), builderResidualPsf: Math.round(lp.builderPsf), landPencils: true,
        seller: sellerOf(s, li), distress: li.distress || undefined,
      } });
      continue;
    }
    const ip = inPlace(rec, s, li.bbl, li.ask);
    const y = li.ask > 0 ? ip.noi / li.ask : 0;
    bldgs.push({ y, row: {
      bbl: li.bbl, address: rec.address, class: rec.class, sf: rec.bldgArea, built: rec.yearBuilt || undefined,
      ask: li.ask, appraisal: r0(assetValue(rec, e, gradeOf(s, rec))),
      noi: r0(ip.noi), yieldPct: pct(y), occ: pct(ip.occ), rollDisclosed: ip.disclosed,
      seller: sellerOf(s, li), distress: li.distress || undefined,
      listed: monthLabel(li.listedM), expires: monthLabel(li.expiresM),
    } });
  }
  bldgs.sort((a, b) => b.y - a.y);
  lots.sort((a, b) => b.y - a.y);

  const street = (s.rivals ?? []).filter((x) => x.failedM === undefined)
    .map((x) => ({ x, eq: rivalEquity(markRival(s, parcels, x), x) }))
    .sort((a, b) => b.eq - a.eq);
  const board = street.filter((q, i) => i < 10 || q.x.aiControlled || q.x.id === r.id)
    .map((q) => ({ rank: street.indexOf(q) + 1, name: q.x.name, equity: r0(q.eq), buildings: q.x.bbls.length, ai: q.x.aiControlled ? true : undefined, you: q.x.id === r.id || undefined }));

  const last = [...(s.aiTurns ?? [])].reverse().find((t) => t.firmId === r.id);
  const eq = rivalEquity(mk, r);
  return {
    protocol: "broadway-wall-ai/1",
    date: monthLabel(s.month), month: s.month,
    firm: {
      id: r.id, name: r.name, equity: r0(eq), cash: r0(r.cash), debt: r0(r.debt), assets: r0(mk.aum),
      ltvPct: pct(mk.aum > 0 ? r.debt / mk.aum : 0), noiYr: r0(mk.noiYr), creditLineRoom: r0(room),
      debtRatePct: +(e.indexRate + 1.9).toFixed(2), inArrearsMonths: r.stressMs || 0,
      jobsUnderConstruction: jobs.length, buildings: r.bbls.length,
    },
    market: {
      phase: e.phase, policyRatePct: +e.indexRate.toFixed(2), creditIndex: +(e.creditIdx ?? 1).toFixed(2),
      capRatePct: roundMap(e.capRate), vacancyPct: roundMap(e.cityVac, 100), rentIndex: roundMap(e.rentIdx),
      costIndex: +(e.costIdx ?? 1).toFixed(2),
      notes: "Closing costs 2% on a purchase. Gains tax 25%. Income tax 25% on NOI after interest and depreciation. Overhead ~0.28% of assets a year. Debt pays index + 1.9%.",
    },
    holdings, sites,
    tape: bldgs.slice(0, TAPE_CAP).map((x) => x.row),
    land: lots.slice(0, LAND_CAP).map((x) => x.row),
    landListed: landSeen,
    street: board,
    news: s.news.slice(0, 8).map((n) => n.text.length > 180 ? n.text.slice(0, 177) + "..." : n.text),
    lastTurn: last ? { m: last.m, results: last.results.slice(0, AI_MAX_ORDERS).map((x) => ({ order: x.order, ok: x.ok, reason: x.reason })) } : undefined,
    actions: AI_ACTIONS,
    reply: 'Respond with ONLY a JSON object: {"reasoning": "<a few sentences>", "orders": [<order>, ...]}. Up to 12 orders; an empty list holds.',
  };
}

function roundMap(m: Partial<Record<BuiltClass, number>> | undefined, k = 1): Record<string, number> {
  const o: Record<string, number> = {};
  for (const [a, b] of Object.entries(m ?? {})) if (typeof b === "number") o[a] = Math.round(b * k * 100) / 100;
  return o;
}

/** What standing stock is worth to its own redeveloper — the same basis startOwnJob carries. */
function redevBasis(s: GameState, r: Rival, rec: ParcelRecord): number {
  const cond = assetGrade(r, rec);
  const hair = cond === "obsolete" ? 0.78 : cond === "worn" ? 0.86 : 0.93;
  return Math.max(landValue(rec, s.econ), assetValue(rec, s.econ, cond) * hair);
}

// ------------------------------------------------------------------ applying

/**
 * EXECUTE ONE TURN OF ORDERS for one AI firm. Every order is judged in turn
 * against the state the previous ones left; a refused order changes nothing.
 * Returns a new state and a verdict per order, and files the turn (reasoning
 * and verdicts) on `s.aiTurns` for the Street table and the match log.
 */
export function applyAiOrders(
  s0: GameState, parcels: ParcelTable, firmId: string, orders: unknown[],
  meta: { reasoning?: string; provider?: string; error?: string; ms?: number } = {},
): { s: GameState; results: AiOrderResult[] } {
  const s = cloneState(s0);
  const results: AiOrderResult[] = [];
  const r = (s.rivals ?? []).find((x) => x.id === firmId);
  if (!r || !r.aiControlled) {
    return { s: s0, results: [{ order: null, ok: false, reason: `No AI-run firm ${firmId}.` }] };
  }
  const list = Array.isArray(orders) ? orders : [];
  for (const [i, raw] of list.entries()) {
    if (i >= AI_MAX_ORDERS) { results.push({ order: raw, ok: false, reason: `Only ${AI_MAX_ORDERS} orders are read per turn.` }); continue; }
    if (r.failedM !== undefined) { results.push({ order: raw, ok: false, reason: "The firm has been wound up." }); continue; }
    const v = validateOrder(raw);
    if (!v.order) { results.push({ order: raw, ok: false, reason: v.why ?? "Invalid order." }); continue; }
    const why = applyOne(s, parcels, r, v.order);
    results.push({ order: v.order, ok: why.ok, reason: why.reason });
  }
  const turn: AiTurn = {
    firmId, m: s.month, provider: meta.provider ?? r.aiControlled.provider,
    reasoning: (meta.reasoning ?? "").slice(0, 1200),
    results, error: meta.error, ms: meta.ms,
  };
  s.aiTurns = [...(s.aiTurns ?? []), turn].slice(-240);
  return { s, results };
}

function applyOne(s: GameState, parcels: ParcelTable, r: Rival, o: AiOrder): { ok: boolean; reason: string } {
  const no = (reason: string) => ({ ok: false, reason });
  switch (o.action) {
    case "hold": return { ok: true, reason: "Held." };

    case "buy": {
      const li = s.listings.find((l) => l.bbl === o.bbl);
      if (!li) return no(`${o.bbl} is not on the tape.`);
      const shut = listingOpen(s, li, r.id);
      if (shut) return no(shut);
      const rec = resolveRec(parcels, s, o.bbl);
      if (!rec) return no(`${o.bbl} is not a lot in this town.`);
      if (li.ask > o.maxPrice) return no(`The ask is ${money(li.ask)}, over your ${money(o.maxPrice)} limit.`);
      if (r.stressMs) return no("A firm in arrears cannot close a purchase.");
      const lev = Math.max(0, Math.min(AI_MAX_LEVERAGE, o.leverage ?? 0.6));
      const snap = aiSnap(r);
      // The loan is sized off the firm's own target leverage (see
      // acquisitionLoan), so the order's leverage is that target for this
      // closing and nothing else.
      const was = r.targetLtv;
      r.targetLtv = lev;
      const buyer = rivalBuys(s, parcels, rec, li.ask, r, li.receiverFor ?? "a private owner");
      r.targetLtv = was;
      if (!buyer) {
        const mk = markRival(s, parcels, r);
        const room = Math.max(0, lineRoom(s, r, mk.aum, mk.noiYr, mk.landV));
        return no(`Cannot fund the close at ${money(li.ask)}: equity + 2% closing + reserve is more than cash ${money(r.cash)} + line room ${money(room)} at ${Math.round(lev * 100)}% leverage (lenders may size less).`);
      }
      s.listings = s.listings.filter((l) => l.bbl !== o.bbl);
      (s.lastTradeM ??= {})[o.bbl] = s.month;
      clearRivalClaims(s, o.bbl);
      const closing = Math.round(li.ask * 0.02);
      aiBook(s, r, {
        kind: "buy", bbl: o.bbl, amount: li.ask, closing, with: sellerOf(s, li),
        cashDelta: r.cash - snap.cash, debtDelta: r.debt - snap.debt,
      });
      s.news.unshift({ q: s.month, kind: "deal", text: `${r.name} bought ${rec.address} for ${money(li.ask)} (${Math.round((r.debt - snap.debt) / li.ask * 100)}% financed).` });
      return { ok: true, reason: `Bought ${rec.address} for ${money(li.ask)}; borrowed ${money(r.debt - snap.debt)}.` };
    }

    case "sell": {
      const own = owned(s, parcels, r, o.bbl);
      if (typeof own === "string") return no(own);
      if (s.listings.some((l) => l.bbl === o.bbl)) return no("It is already on the tape — use reprice.");
      const v = conveyedValue(s, own, o.bbl, false, assetGrade(r, own));
      const ask = Math.round((o.minPrice ?? v) / 1000) * 1000;
      if (ask > v * AI_MAX_ASK_OVER_VALUE) return no(`An ask of ${money(ask)} is more than ${AI_MAX_ASK_OVER_VALUE}x the ${money(Math.round(v))} appraisal; no buyer on this tape pays that.`);
      s.listings.push({ bbl: o.bbl, ask, listedM: s.month, expiresM: s.month + 12, sellerId: r.id, reason: "voluntary" });
      return { ok: true, reason: `Listed ${own.address} at ${money(ask)} (appraisal ${money(Math.round(v))}).` };
    }

    case "reprice": {
      const li = s.listings.find((l) => l.bbl === o.bbl && l.sellerId === r.id);
      if (!li) return no("You have no live listing on that building.");
      const rec = resolveRec(parcels, s, o.bbl);
      if (!rec) return no("Unknown lot.");
      const v = conveyedValue(s, rec, o.bbl, false, assetGrade(r, rec));
      const ask = Math.round(o.ask / 1000) * 1000;
      if (ask > v * AI_MAX_ASK_OVER_VALUE) return no(`An ask over ${AI_MAX_ASK_OVER_VALUE}x the ${money(Math.round(v))} appraisal is refused.`);
      li.ask = ask;
      return { ok: true, reason: `Repriced to ${money(ask)}.` };
    }

    case "withdraw": {
      const n = s.listings.length;
      s.listings = s.listings.filter((l) => !(l.bbl === o.bbl && l.sellerId === r.id));
      return s.listings.length < n ? { ok: true, reason: "Withdrawn from the tape." } : no("You have no live listing on that building.");
    }

    case "refinance": {
      const own = owned(s, parcels, r, o.bbl);
      if (typeof own === "string") return no(own);
      if (own.class === "land" || !own.bldgArea) return no("Land carries no income to refinance against.");
      if (r.stressMs) return no("No desk refinances a borrower in arrears.");
      const mk = markRival(s, parcels, r);
      const a = markAsset(s, r, own);
      const share = mk.aum > 0 ? r.debt * (a.v / mk.aum) : 0;
      const sized = streetRefiProceeds(s, a.v, a.noi, Math.min(AI_MAX_LEVERAGE, STYLE_OF(r.style).maxLtv)).principal;
      const room = Math.max(0, lineRoom(s, r, mk.aum, mk.noiYr, mk.landV));
      const add = Math.round(Math.min(sized - share, room));
      if (add < 250_000) return no(`Lenders size ${money(sized)} on it against ${money(Math.round(share))} already allocated to it (line room ${money(room)}); under $250k of new money.`);
      const fee = Math.round(add * REFI_COST);
      const snap = aiSnap(r);
      r.debt += add;
      r.cash += add - fee;
      aiBook(s, r, { kind: "refi", bbl: o.bbl, amount: add, closing: fee, cashDelta: r.cash - snap.cash, debtDelta: r.debt - snap.debt });
      return { ok: true, reason: `Raised ${money(add)} against ${own.address} (fee ${money(fee)}).` };
    }

    case "paydown": {
      const amt = Math.round(Math.min(o.amount, r.debt));
      if (!(amt > 0)) return no("There is no debt to repay.");
      if (r.cash < amt) return no(`Only ${money(r.cash)} in cash.`);
      const snap = aiSnap(r);
      r.cash -= amt;
      r.debt -= amt;
      aiBook(s, r, { kind: "paydown", amount: amt, cashDelta: r.cash - snap.cash, debtDelta: r.debt - snap.debt });
      return { ok: true, reason: `Repaid ${money(amt)}.` };
    }

    case "develop": {
      const own = owned(s, parcels, r, o.bbl);
      if (typeof own === "string") return no(own);
      if (s.listings.some((l) => l.bbl === o.bbl)) return no("Withdraw the listing before building on it.");
      if (own.lotArea < 2500) return no("The lot is under 2,500 sf.");
      if (r.stressMs) return no("No construction desk lends to a sponsor in arrears.");
      const live = (s.cityJobs ?? []).filter((j) => j.firmId === r.id && !j.orphaned).length;
      if (live >= 3) return no("Three jobs are already under construction.");
      const redev = own.class !== "land" && own.bldgArea > 0;
      const use = o.use;
      const lead = dominantOf(devMix(use));
      const bar = zoneUseBar(own, use, s.econ, use === "mixed" ? devMix(use) : undefined, o.floors);
      if (bar) return no(bar);
      const envelope = Math.max(1, Math.floor(farMaxFor(own) / 0.62));
      if (o.floors > envelope) return no(`Zoning allows about ${envelope} floors at 62% coverage.`);
      const cap = MAX_FLOORS_BY_USE[use];
      if (cap !== undefined && o.floors > cap) return no(`${use} does not stack past ${cap} floors.`);
      const cornice = cityInfillCap(s, parcels, own, Math.min(1, s.month / 780), lead);
      if (o.floors > cornice) return no(`The block's cornice is ${cornice} floors; no lender underwrites a scheme above what the comps support.`);
      if ((s.econ.startOwed?.[lead] ?? 0) <= 0) return no(`No ${lead} tenant demand is waiting for new space — the order book is empty.`);
      const uw = underwriteDevelopment(s, parcels, o.bbl, use, o.floors, 0.62, redev ? redevBasis(s, r, own) : undefined);
      if (!uw) return no("The scheme cannot be planned on this lot.");
      if (!uw.clears) return no(uw.why ?? "The scheme does not clear the hurdle.");
      const plan = uw.plan;
      if (redev && plan.sf < own.bldgArea * 1.12) return no("Redevelopment must add at least 12% floor area.");
      const mk = markRival(s, parcels, r);
      if (plan.costTotal > mk.aum * 0.9 + r.cash * 5) return no(`A ${money(plan.costTotal)} job is too big for a firm this size.`);
      const dayOne = Math.round(plan.equity * 0.40);
      if (r.cash < dayOne + Math.max(400_000, r.cash * 0.03)) return no(`Groundbreak equity is ${money(dayOne)} plus a reserve; cash is ${money(r.cash)}.`);
      const snap = aiSnap(r);
      breakGround(s, parcels, r, o.bbl, own, use, plan, redev);
      aiBook(s, r, { kind: "develop", bbl: o.bbl, amount: dayOne, cashDelta: r.cash - snap.cash, debtDelta: r.debt - snap.debt });
      return { ok: true, reason: `Broke ground: ${Math.round(plan.sf / 1000)}k sf of ${use}, ${plan.floors} floors, ${money(plan.costTotal)}; ${plan.yieldOnCost.toFixed(2)}% on cost vs ${plan.requiredYield.toFixed(2)}% required.` };
    }
  }
}

function owned(s: GameState, parcels: ParcelTable, r: Rival, bbl: string): ParcelRecord | string {
  if (!r.bbls.includes(bbl)) return `You do not own ${bbl}.`;
  if ((s.cityJobs ?? []).some((j) => j.bbl === bbl)) return "It is under construction.";
  if ((s.portfolios ?? []).some((p) => p.bbls.includes(bbl))) return "It is inside a portfolio package.";
  const rec = resolveRec(parcels, s, bbl);
  return rec ?? `${bbl} is not a lot in this town.`;
}

// ------------------------------------------------------------------ the match

export interface AiStanding {
  id: string; name: string; provider: string; model?: string;
  equity: number; cash: number; debt: number; assets: number; buildings: number;
  deals: number; failedM?: number;
}

/** Every AI firm, living or dead, marked the way the street is marked. */
export function aiStandings(s: GameState, parcels: ParcelTable): AiStanding[] {
  return (s.rivals ?? []).filter((r) => r.aiControlled).map((r) => {
    const mk = markRival(s, parcels, r);
    return {
      id: r.id, name: r.name, provider: r.aiControlled!.provider, model: r.aiControlled!.model,
      equity: Math.round(r.failedM !== undefined ? 0 : rivalEquity(mk, r)),
      cash: Math.round(r.cash), debt: Math.round(r.debt), assets: Math.round(mk.aum), buildings: r.bbls.length,
      deals: (s.aiBooks?.[r.id] ?? []).filter((e) => e.kind === "buy" || e.kind === "sale").length,
      failedM: r.failedM,
    };
  }).sort((a, b) => b.equity - a.equity);
}

/** File this quarter's equity marks for the match chart. Returns a new state. */
export function stampAiHistory(s0: GameState, parcels: ParcelTable): GameState {
  if (!(s0.rivals ?? []).some((r) => r.aiControlled)) return s0;
  if ((s0.aiHistory ?? []).some((h) => h.m === s0.month)) return s0;
  const eq: Record<string, number> = {};
  for (const x of aiStandings(s0, parcels)) eq[x.id] = x.equity;
  return { ...s0, aiHistory: [...(s0.aiHistory ?? []), { m: s0.month, eq }].slice(-800) };
}

/** Living AI firm ids, for the controller. */
export const aiFirmIds = (s: GameState) => aiRivals(s).map((r) => r.id);
