// THE COMPS SHEET.
//
// The game could tell you what the city's vacancy was doing and what your own
// buildings were worth, and it could not tell you what anything had actually
// traded for. That is backwards. An appraisal is an opinion; a closed sale is
// a fact, and forming a view out of facts is most of what this job is.
//
// Every deed that moves is recorded here — price, price per foot, the going-in
// cap rate on the price actually paid, who bought and who sold. Two things
// come out of it that nothing else in the game provides:
//
//   • A read on the market that is not the engine telling you the answer. If
//     office is trading at 5.1% this year and traded at 6.4% three years ago,
//     you can see the repricing in the prints rather than in a stat block.
//   • A read on the other firms. A shop that has bought nine buildings in
//     eighteen months is levering into the top and you can watch them do it;
//     one that has printed four sales in a row is getting out.
import type { ParcelRecord } from "@/data/types";
import type { Condition, GameState } from "./types";
import { initialCondition, noiAfterTaxYr } from "./value";

export interface Comp {
  m: number;            // month it closed
  bbl: string;
  address: string;
  cls: string;
  price: number;
  sf: number;           // building area; 0 for dirt
  psf: number;          // $/sf of building, or of LAND when there is no building
  capRate: number;      // going-in on the price actually paid; 0 for land
  buyer: string;
  seller: string;
  distress?: boolean;
}

const MAX_COMPS = 240;

/**
 * Record a closed sale. Called from every path where a deed moves — the
 * player buying, the player selling, and the street trading with itself —
 * because a comps sheet with only some of the trades in it is worse than none.
 */
export function recordComp(
  s: GameState, rec: ParcelRecord, price: number,
  buyer: string, seller: string, distress?: boolean, condition?: Condition,
) {
  if (!rec || price <= 0) return;
  if (!s.comps) s.comps = [];
  const built = rec.class !== "land" && rec.bldgArea > 0;
  const cond = condition ?? initialCondition(rec);
  const noi = built ? noiAfterTaxYr(rec, s.econ, cond, price) : 0;
  s.comps.push({
    m: s.month,
    bbl: rec.bbl,
    address: rec.address,
    cls: rec.class,
    price: Math.round(price),
    sf: built ? rec.bldgArea : 0,
    psf: built ? price / Math.max(1, rec.bldgArea) : price / Math.max(1, rec.lotArea),
    capRate: built && price > 0 ? +((noi / price) * 100).toFixed(2) : 0,
    buyer, seller,
    distress: distress || undefined,
  });
  if (s.comps.length > MAX_COMPS) s.comps.splice(0, s.comps.length - MAX_COMPS);
}

/**
 * What the market has actually been paying for a class, over a window of
 * months. Returns null when there are too few prints to say anything — which
 * is itself the answer, and far more honest than averaging two trades and
 * calling it a market.
 */
export function compStats(s: GameState, cls: string, months = 36) {
  const since = s.month - months;
  // Dirt trades far more often than buildings do in a town still filling in,
  // and a comps sheet that silently dropped every land sale was hiding most
  // of the market. Land has no cap rate; it has a price per foot of LOT, and
  // that is exactly the number a developer is trying to read.
  const land = cls === "land";
  const rows = (s.comps ?? []).filter((c) => c.m >= since && c.cls === cls && (land ? c.sf === 0 : c.sf > 0));
  if (rows.length < 3) return null;
  const caps = rows.map((c) => c.capRate).filter((x) => x > 0).sort((a, b) => a - b);
  const psfs = rows.map((c) => c.psf).sort((a, b) => a - b);
  const mid = (a: number[]) => (a.length ? a[Math.floor(a.length / 2)] : 0);
  return {
    n: rows.length,
    medCap: mid(caps),
    medPsf: mid(psfs),
    volume: rows.reduce((a, c) => a + c.price, 0),
    distressShare: rows.filter((c) => c.distress).length / rows.length,
  };
}

/**
 * Who has been buying and who has been selling, over a window.
 *
 * NAMED PARTICIPANTS ONLY. Half the counterparties in the ledger are
 * placeholders — "a private owner", "a listed seller", "a distressed buyer" —
 * and aggregating them produced a row for the anonymous public reading
 * "getting out, ask why before you buy what they are selling", which is
 * nonsense dressed as insight. A read on a firm is only worth having when
 * there is a firm to read.
 */
export function compFlows(s: GameState, months = 36) {
  const named = new Set<string>(["You", ...(s.rivals ?? []).map((r) => r.name)]);
  const since = s.month - months;
  const by = new Map<string, { bought: number; sold: number; boughtN: number; soldN: number }>();
  const at = (k: string) => {
    let e = by.get(k);
    if (!e) { e = { bought: 0, sold: 0, boughtN: 0, soldN: 0 }; by.set(k, e); }
    return e;
  };
  for (const c of s.comps ?? []) {
    if (c.m < since) continue;
    if (named.has(c.buyer)) { const e = at(c.buyer); e.bought += c.price; e.boughtN++; }
    if (named.has(c.seller)) { const e = at(c.seller); e.sold += c.price; e.soldN++; }
  }
  return [...by.entries()]
    .map(([name, v]) => ({ name, ...v, net: v.bought - v.sold }))
    .sort((a, b) => (b.bought + b.sold) - (a.bought + a.sold));
}
