/**
 * THE SCHEME ON THE BUILD DESK — one reading, asked by the desk, its map card
 * and the building file's footer, so all three price the same building.
 *
 * The desk holds five choices (DevDraft): the use (or a product), the size,
 * the build tier, the look and the leverage. Everything else is the engine's
 * default: a guaranteed-maximum-price contract, the house construction desk,
 * shops at grade where the street carries them, the lender's own takeout.
 * Size is one dial: the storeys, with the footprint the widest the use may
 * cover at that height (maxCoverageFor, maxFloorsFor) — the most building a
 * given height buys on this lot. A fresh desk opens on the scheme the land
 * residual priced (landRead), so the tape and the desk agree.
 *
 * Every figure here is the engine's: planDevelopment, devFundingNeed,
 * groundbreakPurse, siteDebtAtGroundbreak, takeoutHedge*. Nothing is
 * re-derived.
 */
import type { BuildingDesign, Contract, DevDraft, DevUse, GameState, UseMix } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import {
  planDevelopment, maxFloorsFor, maxCoverageFor, MIN_COVERAGE, maxRetailShare, zoneUseBar, devMix,
  devFundingNeed, groundbreakPurse, siteDebtAtGroundbreak, takeoutHedgeRequired, takeoutHedgeCost, constructionQuotes,
} from "@/engine/dev";
import { landRead, resolveRec } from "@/engine/value";
import { CONSTRUCTION_LENDER } from "@/engine/lenders";
import { productOf, productsForUse, layoutProduct, type ProductKey, type ProductType } from "@/engine/products";
import { heldByRaises } from "@/engine/raise";

export const DESK_USES: DevUse[] = ["office", "multifamily", "mixed", "retail", "industrial"];
/** The mixed stack the desk builds: shops at grade, offices, flats (capped by the two-storey retail rule). */
const MIXED = { retail: 15, office: 45, multifamily: 40 };
/** The three leverage choices: none, half, or all the construction lender offers. */
export const LEVERAGE = [0, 0.5, 1] as const;

type Draft = Partial<DevDraft>;

function mixFor(use: DevUse, floors: number, split: { retail: number; office: number; multifamily: number } = MIXED): UseMix | undefined {
  if (use !== "mixed") return undefined;
  const cap = Math.max(0, Math.floor(maxRetailShare(floors) * 100));
  const retail = Math.min(split.retail, cap);
  const rest = Math.max(1, split.office + split.multifamily);
  const office = Math.round((split.office * (100 - retail)) / rest);
  return { retail: retail / 100, office: office / 100, multifamily: (100 - retail - office) / 100 };
}

/** The uses the district hosts on this lot (zoneUseBar, the rule the land was priced on). */
export function legalUses(rec: Parameters<typeof zoneUseBar>[0], econ: GameState["econ"], floors = 1): DevUse[] {
  return DESK_USES.filter((u) => !zoneUseBar(rec, u, econ, u === "mixed" ? devMix("mixed", mixFor("mixed", floors)) : undefined, floors));
}

/** The tallest the use stands on this lot at any footprint it may cover. */
export function topFloors(rec: Parameters<typeof maxFloorsFor>[0], use: DevUse): number {
  const cap = maxCoverageFor(use);
  let top = 1;
  for (let c = MIN_COVERAGE; c <= cap + 1e-9; c += 0.05) top = Math.max(top, maxFloorsFor(rec, Math.min(c, cap), use));
  return Math.max(top, maxFloorsFor(rec, cap, use));
}

/** The widest footprint (to the use's cap) that still carries `floors` storeys. */
export function coverFor(rec: Parameters<typeof maxFloorsFor>[0], use: DevUse, floors: number): number {
  const cap = maxCoverageFor(use);
  for (let c = cap; c >= MIN_COVERAGE - 1e-9; c -= 0.01) if (maxFloorsFor(rec, c, use) >= floors) return +Math.max(MIN_COVERAGE, c).toFixed(2);
  return MIN_COVERAGE;
}

/** The products (pad, centre, flex, box…) this lot's site plan can carry for a use. */
export function productsHere(use: DevUse, lotSf: number): ProductType[] {
  return use === "retail" || use === "industrial" ? productsForUse(use).filter((p) => !!layoutProduct(p, lotSf)) : [];
}

export function deskScheme(game: GameState, parcels: ParcelTable, bbl: string, over?: Draft) {
  const rec = resolveRec(parcels, game, bbl) ?? parcels[bbl];
  const draft: Draft = { ...(game.holdings[bbl]?.devDraft ?? {}), ...(over ?? {}) };
  const fresh = !game.holdings[bbl]?.devDraft && !over;
  const seed = rec?.class === "land" ? landRead(rec, game.econ).scheme : null;
  const legal = legalUses(rec, game.econ);
  const use: DevUse = draft.use ?? (fresh ? seed?.use : undefined) ?? legal[0] ?? "office";
  const prods = productsHere(use, rec.lotArea);
  const pk = draft.product !== undefined ? draft.product : fresh ? seed?.product : undefined;
  const product = pk ? prods.find((p) => p.key === pk) ?? null : null;
  const top = topFloors(rec, use);
  const want = draft.floors ?? (seed && seed.floors > 0 && seed.use === use ? seed.floors : Math.max(1, Math.round(top * 0.6)));
  const floors = product ? 1 : Math.max(1, Math.min(want, top));
  const cap = maxCoverageFor(use);
  let cov = Math.max(MIN_COVERAGE, Math.min(draft.cov ?? (seed?.use === use ? seed.coverage : coverFor(rec, use, floors)), cap));
  if (maxFloorsFor(rec, cov, use) < floors) cov = coverFor(rec, use, floors);
  const spec = draft.spec ?? 0.5;
  const ltcWant = draft.ltcWant ?? 1;
  const design: BuildingDesign = draft.design ?? {};
  const bank = draft.bank || CONSTRUCTION_LENDER;
  const groundRetail = draft.groundRetail ?? "auto";
  const prospect = game.btsProspects?.[bbl];
  const bts = prospect?.use === use && !product ? prospect : undefined;
  const form = design.form ? { retained: design.formRetained ?? 1, skin: design.formSkin ?? 1 } : undefined;
  // the contract and the mixed stack are the player's (More, on the desk)
  const contract: Contract = draft.contract ?? "gmp";
  const custom = { mix: mixFor(use, floors, draft.split), bts, groundRetail, form, ...(product ? { product: product.key as ProductKey } : {}) };
  const planMax = planDevelopment(game, parcels, bbl, use, floors, cov, contract, undefined, custom, bank, spec);
  const ltc = planMax ? planMax.ltcMax * ltcWant : undefined;
  const plan = planMax ? planDevelopment(game, parcels, bbl, use, floors, cov, contract, ltc, custom, bank, spec) : null;
  const bar = zoneUseBar(rec, use, game.econ, use === "mixed" ? devMix("mixed", custom.mix) : undefined, floors);

  // THE CHEQUE, AS THE ENGINE ASKS IT: equity, points, the hedge the lender
  // insists on, the 6% change-order margin, and any land loan repaid at close
  const siteDebt = siteDebtAtGroundbreak(game, bbl).due;
  const takeout: "float" | "cap" | "fixed" = !plan || !(plan.commitment > 0) ? "float"
    : draft.takeout && !(takeoutHedgeRequired(plan) && draft.takeout === "float") ? draft.takeout
    : takeoutHedgeRequired(plan) ? "cap" : "float";
  const hedge = plan ? takeoutHedgeCost(plan, takeout) : 0;
  const need0 = plan ? devFundingNeed(plan, hedge) : { whole: 0, dayOne: 0, margin: 0 };
  const need = { ...need0, whole: need0.whole + (plan ? siteDebt : 0), dayOne: need0.dayOne + (plan ? siteDebt : 0) };
  const purse = groundbreakPurse(game, parcels, bbl);
  const have = purse.closed ? 0 : Math.max(0, purse.total - (purse.fund ? 0 : heldByRaises(game, bbl)));
  const short = Math.max(0, need.whole - have, need.dayOne - have);
  const worth = plan && plan.exitYield > 0 ? plan.stabNoi / (plan.exitYield / 100) : 0;
  const profit = plan ? worth - plan.basisTotal : 0;
  // every desk's terms on this job, for the lender choice
  const quotes = planMax ? constructionQuotes(game, planMax.mix, planMax.costTotal) : [];
  const quote = plan ? quotes.find((q) => q.lender === plan.lender) : undefined;
  const why = !plan ? (bar ?? "No scheme prices here")
    : purse.closed ? purse.closed
    : game.raises?.[bbl] ? "A raise is open on this lot"
    : short > 0 ? `Short ${Math.round(short / 1000).toLocaleString()}K`
    : null;
  const commitArgs = [use, floors, cov, contract, ltc, { ...custom, design, takeout }, plan?.lender ?? bank, spec] as const;
  return {
    rec, draft, use, legal, prods, product, floors, top, cov, spec, ltcWant, design, plan, planMax, bar, prospect: bts,
    siteDebt, takeout, hedge, need, have, short, worth, profit, quote, quotes, bank, why, purse, commitArgs, contract, groundRetail,
  };
}
export type DeskScheme = ReturnType<typeof deskScheme>;

/**
 * THE BEST STARTING POINTS ON THIS LOT: every legal use at a spread of sizes
 * (each at the footprint the size dial would give it) and every product the
 * lot carries, through the same deskScheme, ranked by the hurdle ratio.
 */
export function bestStarts(game: GameState, parcels: ParcelTable, bbl: string, n = 3) {
  const rec = resolveRec(parcels, game, bbl) ?? parcels[bbl];
  if (!rec) return [];
  const out: { use: DevUse; floors: number; product?: ProductKey; hurdle: number; profit: number }[] = [];
  for (const u of legalUses(rec, game.econ)) {
    const top = topFloors(rec, u);
    const steps = [...new Set([2, 4, 6, 8, 12, 16, 20, 25, 30, 40, top].filter((f) => f >= 1 && f <= top))];
    for (const f of steps) {
      const d = deskScheme(game, parcels, bbl, { use: u, floors: f, cov: coverFor(rec, u, f), product: undefined, spec: 0.5, ltcWant: 1 });
      if (d.plan) out.push({ use: u, floors: f, hurdle: d.plan.hurdleRatio, profit: d.profit });
    }
    for (const p of productsHere(u, rec.lotArea)) {
      const d = deskScheme(game, parcels, bbl, { use: u, product: p.key, spec: 0.5, ltcWant: 1 });
      if (d.plan) out.push({ use: u, floors: 1, product: p.key, hurdle: d.plan.hurdleRatio, profit: d.profit });
    }
  }
  return out.sort((a, b) => b.hurdle - a.hurdle).slice(0, n);
}

export const productName = (k?: string) => productOf(k)?.short;
