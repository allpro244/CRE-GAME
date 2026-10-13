// A FIRM'S PLAN — the thesis it is running for the next few years.
//
// Every month a firm used to ask one question of every listing: "would I buy
// this?" That makes a committee, not a strategy. Real shops raise money on a
// thesis — "industrial on the east edge while rates are high", "assemble the
// block on Pier Street and build", "sell into this market and wait" — run it
// for three to five years, and drop it when it stops working.
//
// So each named firm with a sheet carries one `Thesis`, chosen from its sheet
// and what the market looks like the year it chooses:
//
//   deleverage   it is over its own comfort and stops buying until it is not
//   assemble     an assembler picks a block and buys toward it (then builds)
//   build        a builder picks a class and a district and puts up buildings
//   distress     a distress hunter in a shut credit window works the receivers
//   harvest      a short holder in a hot market sells into the strength
//   accumulate   everyone else: one class, one district, until the money is in
//
// It steers buying through `thesisFit` (a multiplier on the sheet's own fit —
// focus, not a new rule) and selling through `thesisSellMult`. It is revised
// once a year: when it runs out, when equity falls a fifth under it, when an
// accumulation has found nothing in two years, or when leverage forces a
// pull-back. The firm card and "what's coming" read its label.
//
// Nothing here draws on the RNG stream: choices are hashed per firm and year.
import type { ParcelTable } from "@/data/types";
import type { GameState, Rival, Thesis } from "./types";
import { START_YEAR } from "./types";
import { CLASS_FLOOR, hash01 } from "./competitorTraits";
import { demandLinear } from "./value";

const CLASS_TRAIT: Record<string, "office" | "residential" | "retail" | "industrial" | "land"> = {
  office: "office", multifamily: "residential", retail: "retail", industrial: "industrial", land: "land",
};
const CLASS_WORD: Record<string, string> = {
  office: "office", multifamily: "apartments", retail: "retail", industrial: "industrial", land: "land",
};

/** Each district's mean demand score and name, cached per parcel table. */
let distCache: { p: ParcelTable; d: Map<string, { name: string; demand: number; n: number }> } | null = null;
function districts(parcels: ParcelTable) {
  if (distCache?.p === parcels) return distCache.d;
  const d = new Map<string, { name: string; demand: number; n: number }>();
  for (const rec of Object.values(parcels)) {
    if (!rec?.district) continue;
    const x = d.get(rec.district) ?? { name: rec.districtName ?? rec.district, demand: 0, n: 0 };
    x.demand += demandLinear(rec.demandScore ?? 50);
    x.n++;
    d.set(rec.district, x);
  }
  for (const x of d.values()) x.demand /= Math.max(1, x.n);
  distCache = { p: parcels, d };
  return d;
}

export interface ThesisContext {
  /** the firm's own covenant (paramsOf(r).maxLtv) */
  maxLtv: number;
  /** debt over the book's mark today */
  lev: number;
  /** the classes the firm may buy (paramsOf(r).classes; null = all) */
  classes: string[] | null;
  /** whether the firm builds (paramsOf(r).build > 0) */
  builds: boolean;
}

/** What the firm calls its plan, in a line. */
export function thesisLabel(t: Thesis): string {
  const until = START_YEAR + Math.floor(t.untilM / 12);
  const cls = t.cls ? CLASS_WORD[t.cls] ?? t.cls : "property";
  const where = t.districtName ? ` in ${t.districtName}` : "";
  switch (t.kind) {
    case "deleverage": return `Paying down debt — no buying until the book is safe`;
    case "assemble": return `Assembling a block${where} to build on, through ${until}`;
    case "build": return `Building ${cls}${where}, through ${until}`;
    case "distress": return `Working the receivers' lists while credit is shut, through ${until}`;
    case "harvest": return `Selling into a strong market and waiting, through ${until}`;
    case "contrarian": return `Buying while nobody else can — the window is shut and it has the cash`;
    default: return `Accumulating ${cls}${where}, through ${until}`;
  }
}

/** The firm's equity on its race chart at or before month `m` (eqHist is yearly). */
function equityAt(r: Rival, m: number): number | undefined {
  const h = r.eqHist ?? [];
  let v: number | undefined;
  for (const [y, e] of h) if (y * 12 <= m) v = e;
  return v;
}

/** Deeds bought since `m` that fit the thesis. */
function boughtSince(r: Rival, m: number): number {
  let n = 0;
  for (const [, since] of Object.entries(r.heldSince ?? {})) if (since >= m) n++;
  return n;
}

/**
 * CHOOSE A THESIS. Its sheet decides what kind of plan a firm makes; the
 * market decides which class and where. A value buyer (low Cycle) leans to
 * the class whose cap rate is widest — the cheap one — and a momentum buyer to
 * the tightest, the one everybody wants.
 */
function choose(s: GameState, parcels: ParcelTable, r: Rival, ctx: ThesisContext, why: string): Thesis {
  const sh = r.sheet!;
  const h = (k: string) => hash01(`${s.seed}:thesis:${r.id}:${s.month}:${k}`);
  const ci = s.econ.creditIdx ?? 1;
  const years = 3 + Math.floor(h("len") * 3);
  const base = { fromM: s.month, untilM: s.month + years * 12, why };

  if ((r.stressMs ?? 0) > 0 || ctx.lev > ctx.maxLtv - 0.03) {
    return { ...base, kind: "deleverage", untilM: s.month + 24 };
  }
  // THE CONTRARIAN'S MOMENT. Low Cycle, room under its covenant, cash in the
  // account and the credit window shut: it buys broadly until the window
  // reopens, because this is the market it kept its powder dry for.
  if (sh.cycle < 35 && ci < 0.92 && ctx.lev < ctx.maxLtv - 0.10 && r.cash > 0) {
    return { ...base, kind: "contrarian", untilM: s.month + 36 };
  }
  // where: home turf for a local firm, else the district matching its taste
  // for prime or edge (hashed among the three that fit best)
  const ds = [...districts(parcels).entries()];
  const want = (sh.prime - sh.edge) / 100;   // +1 prime .. -1 edge
  let district = sh.homeTurf >= 60 && r.home ? r.home : undefined;
  if (!district && ds.length) {
    const ranked = ds.map(([k, x]) => ({ k, score: want * (x.demand - 50) / 50 + (r.home === k ? 0.2 : 0) }))
      .sort((a, b) => b.score - a.score).slice(0, 3);
    district = ranked[Math.floor(h("d") * ranked.length)]?.k;
  }
  const districtName = district ? districts(parcels).get(district)?.name : undefined;

  if (sh.assembly >= 70 && ctx.builds) {
    // the block where it already owns the most lots, else one in its district
    const byBlock = new Map<string, number>();
    for (const b of r.bbls) { const blk = parcels[b]?.block; if (blk) byBlock.set(blk, (byBlock.get(blk) ?? 0) + 1); }
    let block = [...byBlock.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!block && district) {
      const blocks = [...new Set(Object.values(parcels).filter((x) => x?.district === district && x.block).map((x) => x.block!))];
      block = blocks[Math.floor(h("b") * blocks.length)];
    }
    if (block) return { ...base, kind: "assemble", block, district, districtName, untilM: s.month + 60 };
  }
  if (sh.distress >= 65 && ci < 0.9) return { ...base, kind: "distress" };
  if (sh.hold <= 35 && ci > 1.05 && r.bbls.length >= 3) return { ...base, kind: "harvest", untilM: s.month + 24 + Math.floor(h("hv") * 12) };

  // which class: the sheet's own weight, tilted by the market's price of it
  const caps = s.econ.capRate as Record<string, number>;
  const capVals = Object.values(caps ?? {}).filter((x) => x > 0);
  const avgCap = capVals.length ? capVals.reduce((a, b) => a + b, 0) / capVals.length : 0;
  const value = sh.cycle < 50 ? 1 : -1;
  let cls: string | undefined, best = -Infinity;
  for (const [c, k] of Object.entries(CLASS_TRAIT)) {
    if (sh[k] < CLASS_FLOOR) continue;
    if (ctx.classes && !ctx.classes.includes(c)) continue;
    if (c === "land" && !ctx.builds) continue;
    const cap = caps?.[c];
    const tilt = cap && avgCap ? value * (cap - avgCap) / avgCap * 2 : 0;
    const score = sh[k] / 100 + tilt + h(`c${c}`) * 0.2;
    if (score > best) { best = score; cls = c; }
  }
  const kind: Thesis["kind"] = ctx.builds && sh.build >= 65 && ci >= 0.9 ? "build" : "accumulate";
  return { ...base, kind, cls: kind === "build" && cls === "land" ? undefined : cls, district, districtName };
}

/**
 * ONCE A YEAR: keep the plan, or change it. Returns the news line when the
 * change is worth telling (null otherwise).
 */
export function reviewThesis(s: GameState, parcels: ParcelTable, r: Rival, ctx: ThesisContext): string | null {
  if (!r.sheet || r.failedM !== undefined) return null;
  const t = r.thesis;
  let why: string | null = null;
  if (!t) why = "first";
  else if (s.month >= t.untilM) why = "ran its course";
  else if (t.kind !== "deleverage" && ((r.stressMs ?? 0) > 0 || ctx.lev > ctx.maxLtv - 0.03)) why = "pulled back";
  else if (t.kind === "deleverage" && ctx.lev < ctx.maxLtv - 0.12 && !(r.stressMs ?? 0)) why = "back to work";
  else if (t.kind !== "contrarian" && r.sheet.cycle < 35 && (s.econ.creditIdx ?? 1) < 0.92 && ctx.lev < ctx.maxLtv - 0.10 && r.cash > 0) why = "window shut";
  else if (t.kind === "contrarian" && (s.econ.creditIdx ?? 1) >= 1) why = "window open";
  else if ((t.kind === "accumulate" || t.kind === "build" || t.kind === "assemble") && s.month - t.fromM >= 24 && boughtSince(r, t.fromM) === 0) why = "found nothing";
  else {
    const e0 = equityAt(r, t.fromM), e1 = equityAt(r, s.month);
    if (e0 && e1 !== undefined && e0 > 0 && e1 / e0 < 0.8 && s.month - t.fromM >= 12) why = "not working";
  }
  if (!why) return null;
  const old = t;
  r.thesis = choose(s, parcels, r, ctx, why);
  if (!old) return null;
  const was = thesisLabel(old).split(",")[0].replace(/ through \d+$/, "").toLowerCase();
  const now = thesisLabel(r.thesis).split(",")[0].replace(/ through \d+$/, "").toLowerCase();
  switch (why) {
    case "pulled back": return `${r.name} has shelved its plan (${was}). The book is carrying too much debt, and it is selling, not buying.`;
    case "found nothing": return `${r.name} has given up ${was} after two years without a deal. New plan: ${now}.`;
    case "not working": return `${r.name}'s plan — ${was} — has cost it a fifth of its equity. It is changing course: ${now}.`;
    case "back to work": return `${r.name} has its debt where it wants it and is buying again: ${now}.`;
    case "window shut": return `Credit has shut, and ${r.name} — which kept its cash through the good years — has started buying. This is the market it was waiting for.`;
    case "window open": return `Credit is easy again and ${r.name} has stopped buying. It will sit on its hands until somebody else's party ends.`;
    default: return null;
  }
}

/** Facts about one site, for `thesisFit`. */
export interface ThesisSite { cls: string; district: string; block?: string; distress: boolean }

/**
 * HOW THE PLAN BENDS ONE BUY — a multiplier on the sheet's own fit. Focus,
 * not a rule: a firm accumulating industrial on the edge still buys a cheap
 * office downtown, just much less keenly. A firm paying down debt buys
 * nothing at all.
 */
export function thesisFit(r: Rival, x: ThesisSite): number {
  const t = r.thesis;
  if (!t) return 1;
  switch (t.kind) {
    case "deleverage": return 0;
    case "harvest": return 0.5;
    case "distress": return x.distress ? 2 : 0.6;
    case "contrarian": return x.distress ? 2.2 : 1.6;
    case "assemble":
      if (t.block && x.block === t.block) return 4;
      return t.district && x.district === t.district ? 1.2 : 0.7;
    default: {
      const cls = !t.cls || x.cls === t.cls ? 1.6 : 0.7;
      const where = !t.district || x.district === t.district ? 1.5 : 0.8;
      return cls * where;
    }
  }
}

/** How the plan bends the firm's selling: a harvester sells into strength, a firm paying down debt sells its weakest. */
export function thesisSellMult(r: Rival): number {
  const k = r.thesis?.kind;
  return k === "harvest" ? 3 : k === "deleverage" ? 4 : 1;
}

/** The block an assembler is building toward, if it owns enough of it to build. */
export function assembledBlock(r: Rival, parcels: ParcelTable, min = 3): string | undefined {
  const t = r.thesis;
  if (t?.kind !== "assemble" || !t.block) return undefined;
  const n = r.bbls.filter((b) => parcels[b]?.block === t.block).length;
  return n >= min ? t.block : undefined;
}
