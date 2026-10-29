// THE FIRM BOOKS, READ FOR THE SCREENS (ONE_ECONOMY_PLAN step 9a, §6e).
//
// Pure reads of `s.economy` (economy.ts) and the IO table (industries.ts):
// a business's books, where it sits, its last twelve months; each industry's
// trend; who an industry buys from and sells to, in dollars; and how much of
// a player's rent rests on which tenant industry and on whose spending.
// Nothing here writes the state.
import type { GameState, Holding, Tenant } from "@/engine/types";
import { REV_RING, reviveEconomy } from "@/engine/economy";
import { INDUSTRIES, INDUSTRY_IDS, INDUSTRY_INDEX, IO_A, N_IND, type IndustryId } from "@/engine/industries";

export interface BizPlace { t: Tenant; bbl?: string; own: boolean; looking: boolean }

const placeMemo = new WeakMap<object, Map<number, BizPlace>>();
/** Every named business by firm id: its tenant record and where it sits (yours first, then the street, then the looking pool). */
export function bizPlaces(g: GameState): Map<number, BizPlace> {
  const hit = placeMemo.get(g);
  if (hit) return hit;
  const out = new Map<number, BizPlace>();
  for (const h of Object.values(g.holdings)) for (const t of h.tenants ?? []) {
    if (t.fid !== undefined && !out.has(t.fid)) out.set(t.fid, { t, bbl: h.bbl, own: true, looking: false });
  }
  for (const [bbl, roll] of Object.entries(g.econ.streetRolls ?? {})) for (const t of roll.t) {
    if (t.fid !== undefined && !out.has(t.fid)) out.set(t.fid, { t, bbl, own: false, looking: false });
  }
  for (const k of g.econ.seekers ?? []) if (k.t && !out.has(k.fid)) out.set(k.fid, { t: k.t, bbl: k.from, own: false, looking: true });
  placeMemo.set(g, out);
  return out;
}

const slotMemo = new WeakMap<object, Map<number, number>>();
/** Firm id -> its row in the economy's columns. */
function slots(g: GameState): Map<number, number> {
  const E = g.economy;
  if (!E) return new Map();
  const hit = slotMemo.get(E);
  if (hit) return hit;
  reviveEconomy(E);
  const out = new Map<number, number>();
  for (let n = 0; n < E.L.slot.n; n++) out.set(E.f.id[n], n);
  slotMemo.set(E, out);
  return out;
}

export function bizIndustry(g: GameState, fid: number | undefined): IndustryId | null {
  if (fid === undefined || !g.economy) return null;
  const n = slots(g).get(fid);
  return n === undefined ? null : INDUSTRY_IDS[g.economy.f.ind[n]];
}

/** A firm's monthly revenue over the last twelve months, oldest first (only months it had books and the ring was kept). */
export function bizRevHist(g: GameState, fid: number): number[] {
  const E = g.economy;
  const n = slots(g).get(fid);
  if (!E?.last || n === undefined) return [];
  const F = E.f, last = E.last.m, out: number[] = [];
  for (let k = 11; k >= 0; k--) {
    const m = last - k;
    if (m < F.openM[n] || m < E.openM) continue;
    const v = F[REV_RING[((m % 12) + 12) % 12]][n];
    if (!out.length && !(v > 0)) continue;   // months before the ring existed (an older save)
    out.push(v);
  }
  return out;
}

/** The most recent cause-ledger event naming this business (last three years), for its "Why?". */
export function bizWhy(g: GameState, name: string): { id: number; t: string; m: number } | null {
  const ev = g.why?.ev;
  if (!ev) return null;
  for (let i = ev.length - 1; i >= 0; i--) {
    const e = ev[i];
    if (e.m < g.month - 36) break;
    if (e.name === name && (e.a === "tenant" || e.a === "firm")) return { id: e.id, t: e.t, m: e.m };
  }
  return null;
}

export const GROUP_WORD: Record<string, string> = {
  making: "Making things", moving: "Moving goods", selling: "Shops and services", office: "Offices", other: "Other",
};

/** Each industry's last 13 months, oldest first: output, jobs, exports and margin series. */
export function industryTrend(g: GameState, i: number) {
  const ih = g.economy?.ih ?? [];
  return {
    x: ih.map((h) => h.x[i]), heads: ih.map((h) => h.heads[i]), ex: ih.map((h) => h.ex[i]), mg: ih.map((h) => h.mg[i]),
  };
}

/** Named firms in an industry, largest revenue first, and how many off-map firms stand for the rest. */
export function industryFirms(g: GameState, i: number): { named: { fid: number; rev: number; heads: number }[]; offMap: number } {
  const E = g.economy;
  if (!E) return { named: [], offMap: 0 };
  reviveEconomy(E);
  const F = E.f, named: { fid: number; rev: number; heads: number }[] = [];
  let offMap = 0;
  for (let n = 0; n < E.L.slot.n; n++) {
    if (F.ind[n] !== i) continue;
    if (F.id[n] >= 0) named.push({ fid: F.id[n], rev: F.rev[n], heads: F.hc[n] });
    else offMap++;
  }
  named.sort((a, b) => b.rev - a.rev);
  return { named, offMap };
}

export interface Flow { key: string; label: string; v: number; local?: number; ind?: IndustryId }

/**
 * WHO AN INDUSTRY BUYS FROM AND SELLS TO, a month, from last month's solved
 * output and the IO table: purchases A[k][j]·x[k] (the local share from the
 * town's firms at the local purchase coefficient, the rest from outside);
 * sales to each industry rpc[k]·A[j][k]·x[j], plus households, the city,
 * building projects and out-of-town buyers (economy.ts `buy`). The two lists
 * each sum to the industry's output (sales) and its bought inputs.
 */
export function supplyChain(g: GameState, k: number): { buys: Flow[]; sells: Flow[]; output: number } | null {
  const E = g.economy, l = E?.last;
  if (!E || !l) return null;
  const x = l.x, rpc = E.rpc, b = l.buy[k], id = INDUSTRY_IDS[k], row = IO_A[id];
  const buys: Flow[] = [];
  for (let j = 0; j < N_IND; j++) {
    const v = row[j] * x[k];
    if (v > 0) buys.push({ key: INDUSTRY_IDS[j], label: INDUSTRIES[INDUSTRY_IDS[j]].label, v, local: v * rpc[j], ind: INDUSTRY_IDS[j] });
  }
  const raw = INDUSTRIES[id].primary * x[k];
  if (raw > 0) buys.push({ key: "primary", label: "Farms, mines and oil (out of town)", v: raw, local: 0 });
  const con = INDUSTRY_INDEX.construction;
  const sells: Flow[] = [
    { key: "households", label: "Households", v: b[0] },
    { key: "government", label: "City and state", v: b[2] },
    { key: "projects", label: "Building projects", v: Math.max(0, b[3] - rpc[k] * IO_A.construction[k] * x[con]) },
    { key: "exports", label: "Out-of-town buyers", v: b[4] },
  ];
  for (let j = 0; j < N_IND; j++) {
    const v = rpc[k] * IO_A[INDUSTRY_IDS[j]][k] * x[j];
    if (v > 0) sells.push({ key: INDUSTRY_IDS[j], label: INDUSTRIES[INDUSTRY_IDS[j]].label, v, ind: INDUSTRY_IDS[j] });
  }
  buys.sort((a, c) => c.v - a.v);
  sells.sort((a, c) => c.v - a.v);
  return { buys, sells, output: x[k] };
}

/** The player's tenants by industry: firms, feet and rent a year. */
export function yourTenantsByIndustry(g: GameState): Map<IndustryId, { firms: number; sf: number; rentYr: number }> {
  const out = new Map<IndustryId, { firms: number; sf: number; rentYr: number }>();
  for (const h of Object.values(g.holdings)) for (const t of h.tenants ?? []) {
    const ind = bizIndustry(g, t.fid);
    if (!ind) continue;
    const r = out.get(ind) ?? { firms: 0, sf: 0, rentYr: 0 };
    r.firms++; r.sf += t.sf; r.rentYr += t.sf * t.rentPsf;
    out.set(ind, r);
  }
  return out;
}

/**
 * A BUILDING'S EXPOSURE (§6e forward look): its commercial rent by the
 * tenant's industry, and the same rent spread over whose spending pays those
 * tenants — each tenant's rent split by its industry's sales last month
 * (households, the city, building projects, out-of-town buyers, and each
 * industry that buys from it). Shares of the rent whose tenant has books.
 */
export function rentExposure(g: GameState, h: Holding): { rentYr: number; covered: number; byInd: Flow[]; byBuyer: Flow[] } | null {
  const E = g.economy, l = E?.last;
  if (!E || !l) return null;
  const byInd = new Map<string, number>(), byBuyer = new Map<string, number>();
  let rentYr = 0, covered = 0;
  const sellShares = new Map<number, Flow[]>();
  for (const t of h.tenants ?? []) {
    if (t.use === "multifamily") continue;
    const r = t.sf * t.rentPsf;
    rentYr += r;
    const ind = bizIndustry(g, t.fid);
    if (!ind) continue;
    covered += r;
    byInd.set(ind, (byInd.get(ind) ?? 0) + r);
    const k = INDUSTRY_INDEX[ind];
    let sc = sellShares.get(k);
    if (!sc) { sc = supplyChain(g, k)?.sells ?? []; sellShares.set(k, sc); }
    const tot = sc.reduce((a, f) => a + f.v, 0);
    if (tot > 0) for (const f of sc) byBuyer.set(f.key, (byBuyer.get(f.key) ?? 0) + r * f.v / tot);
  }
  if (!(covered > 0)) return { rentYr, covered: 0, byInd: [], byBuyer: [] };
  const label = (key: string) => key in INDUSTRIES ? INDUSTRIES[key as IndustryId].label
    : key === "households" ? "households" : key === "government" ? "the city" : key === "projects" ? "building projects" : "out-of-town buyers";
  const list = (m: Map<string, number>): Flow[] => [...m.entries()].map(([key, v]) => ({ key, label: label(key), v: v / covered, ind: key in INDUSTRIES ? key as IndustryId : undefined }))
    .sort((a, b) => b.v - a.v);
  return { rentYr, covered, byInd: list(byInd), byBuyer: list(byBuyer) };
}

/** A short plain industry name for tight rows: the label's first clause. */
export function shortInd(id: IndustryId): string {
  return INDUSTRIES[id].label.split(/,| and /)[0];
}
