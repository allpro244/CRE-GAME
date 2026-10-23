/**
 * THE PLAT ON THE LAND DESK — one reading for the desk and the building
 * file's footer, so the plat the desk prices is the plat the footer files.
 *
 * The desk holds four choices: the lot size, the street pattern, the
 * amenities (toggles, each set down by the geometry where it serves most
 * lots) and whether to take the A&D loan. A draft survives leaving the tab
 * (and a reload, where storage is allowed). What is on file — a pending
 * application's plat, a plat being built — is fixed.
 *
 * Every number is the engine's (platdesign.ts designPnl / adQuote,
 * landdev.ts entitleQuote); the geometry is citygen's (platTractDesign).
 */
import { useSyncExternalStore } from "react";
import type { GameState, PlatDesign, AmenityKind } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import { platTractDesign, designSummary } from "@/citygen/index.mjs";
import { defaultDesign, designRecipe, designPnl, adQuote, tractYield } from "@/engine/platdesign";
import { entitleQuote } from "@/engine/landdev";
import { spendable } from "@/engine/credit";

type Draft = { design: PlatDesign; lev: number };
const DRAFTS = new Map<string, Draft>();
const subs = new Set<() => void>();
let version = 0;
const key = (seed: number, bbl: string) => `bw:platdraft:${seed}:${bbl}`;

function load(seed: number, bbl: string): Draft | null {
  const m = DRAFTS.get(bbl);
  if (m) return m;
  try {
    const s = localStorage.getItem(key(seed, bbl));
    if (!s) return null;
    const o = JSON.parse(s);
    // old drafts stored the design alone
    return o && o.design ? o as Draft : { design: o as PlatDesign, lev: 1 };
  } catch { return null; }
}

export function setPlatDraft(seed: number, bbl: string, d: Draft) {
  DRAFTS.set(bbl, d);
  try { localStorage.setItem(key(seed, bbl), JSON.stringify(d)); } catch { /* storage blocked */ }
  version++;
  for (const f of subs) f();
}
/** Re-render on a draft change anywhere (the desk and the footer read one draft). */
export function usePlatDrafts() {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => version);
}

// the geometry and its price, per design, per month (the desk redraws on every choice; the footer asks again)
const CACHE = new Map<string, ReturnType<typeof compute>>();
function compute(game: GameState, parcels: ParcelTable, bbl: string, design: PlatDesign, lev: number) {
  const rec = parcels[bbl];
  const tract = rec?.tract;
  if (!tract) return null;
  const buildableSf = rec.buildableSf ?? rec.lotArea;
  const geo = platTractDesign(tract, designRecipe(design, buildableSf));
  const summary = designSummary(geo);
  const pnl = designPnl(game, parcels, bbl, design, summary);
  const ad = pnl ? adQuote(game, pnl, lev) : null;
  return { geo, summary, pnl, ad };
}

export function platScheme(game: GameState, parcels: ParcelTable, bbl: string) {
  const rec = parcels[bbl];
  const app = game.entitlementApps?.[bbl];
  const rz = game.rezoned?.[bbl];
  const plat = game.plats?.[bbl];
  const locked = !!app || !!plat;
  const draft = load(game.seed, bbl);
  const design: PlatDesign = plat?.design ?? app?.design ?? draft?.design ?? rz?.design ?? defaultDesign();
  const lev = draft?.lev ?? 1;
  const k = `${game.seed}:${game.month}:${bbl}:${!!rz}:${!!app}:${!!plat}:${lev}:${JSON.stringify(design)}`;
  if (!CACHE.has(k)) { if (CACHE.size > 60) CACHE.clear(); CACHE.set(k, compute(game, parcels, bbl, design, lev)); }
  const c = CACHE.get(k) ?? null;
  const owned = !!game.holdings[bbl];
  const pnl = c?.pnl ?? null, ad = c?.ad ?? null;
  // whether a plat fits is the tract's yield (tractYield), not this draft's: the file's Overview count
  const developable = !!rec?.tract && (!!plat || !!app || tractYield(rec, 7_500).n >= 4 || (pnl?.lots ?? 0) >= 4);
  const eq = owned && !rz && !app && pnl ? entitleQuote(game, parcels, bbl, 7500, Math.max(4, pnl.lots)) : null;
  const h = game.holdings[bbl];
  // THE ENGINE'S OWN REFUSALS, SAID BEFORE THE CLICK (platdesign.ts startDesignedPlat)
  const over = !!rz && rz.lots !== undefined && !!pnl && pnl.lots > rz.lots;
  const step: "buy" | "rezone" | "board" | "streets" | "building" | "done" = !owned ? "buy" : plat ? (plat.done ? "done" : "building")
    : app ? "board" : rz ? "streets" : "rezone";
  const why = step === "rezone" ? (!eq || (pnl?.lots ?? 0) < 4 ? "No plat fits" : null)
    : step === "streets" ? (over ? `${pnl!.lots} lots · ${rz!.lots} approved`
      : h?.loan ? "Pay off the loan"
      : h?.sale ? "Delist it first"
      : ad && ad.equityNow > spendable(game, parcels).total ? `Short ${Math.round((ad.equityNow - spendable(game, parcels).total) / 1000).toLocaleString()}K`
      : null)
    : step === "buy" ? "Buy the tract" : "On file";
  return { rec, app, rz, plat, locked, design, lev, geo: c?.geo ?? null, pnl, ad, eq, owned, developable, step, why };
}
export type PlatScheme = ReturnType<typeof platScheme>;

/** The commit the desk and the footer share: file the rezoning with this plat, or build its streets. */
export function platCommit(s: PlatScheme, bbl: string, store: { fileDesignedRezoning: (b: string, d: PlatDesign) => void; buildDesignedPlat: (b: string, d: PlatDesign, lev: number) => void }) {
  if (s.step === "rezone") store.fileDesignedRezoning(bbl, s.design);
  else if (s.step === "streets") store.buildDesignedPlat(bbl, s.design, s.lev);
}

/** The amenities the desk offers as toggles (the rest of AMENITIES are variants of these). */
export const PLAT_AMENITIES: AmenityKind[] = ["park", "greenway", "pool", "entry"];
