// THE NUMBERS ON THE SCREENS, AND WHY THEY MOVED (ONE_ECONOMY_PLAN §6e).
//
// The mechanisms that move a market-wide number — a class's vacancy, the
// apartment rent, land, construction cost, pay, the base rate — each settle
// it somewhere deep in the month. This reads them once the month is done and,
// where one has moved enough to notice since it was last written down, writes
// the move into the cause ledger (why.ts) with what drove it, and points a
// named mark at it (`whyMark`) so the screen showing the number can show its
// "Why?". The commercial rents are written where the leases are read
// (market.ts, `market.rent`) and the cap rates where the trades are
// (propmarket.ts, `market.cap`).
//
// Records only: no random number is drawn here and nothing but the ledger is
// written. Each number is written when it has moved past its step (or once a
// year), so the ledger holds a few dozen of these a year, not one per month.
import type { BuiltClass, GameState } from "./types";
import { BUILT_CLASSES, monthLabel } from "./types";
import { why, whyAt, whyGet, whyMark, whyNation, whyOnce } from "./why";
import { whyTown, whyIndustry, industryOfFirm } from "./economy";
import { whyTrades } from "./contractors";
import { availability } from "./space";
import { normalVac, SECTOR_LABEL } from "./market";

const sgnPct = (x: number, d = 1) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(d)}%`;
const k$ = (sf: number) => sf >= 1e6 ? `${(sf / 1e6).toFixed(1)}M` : `${Math.round(sf / 1000)}k`;

/** The last value a mark was written at, and when. */
function prevOf(s: GameState, mark: string, field: string): { v: number; m: number } | undefined {
  const e = whyGet(s, whyAt(s, mark));
  const v = e?.n?.[field];
  return e && typeof v === "number" ? { v, m: e.m } : undefined;
}

/**
 * A CLASS'S AVAILABILITY this month (once a month, made when first cited): the
 * rate against its normal, what was delivered since it was last written, and
 * the town's month — the jobs that fill space or empty it.
 */
export function whyVacancy(s: GameState, k: BuiltClass): number {
  return whyOnce(s, `vac:${k}:${s.month}`, () => {
    const e = s.econ;
    const vac = availability(e, k), nv = normalVac(e, k), stock = e.stock?.[k] ?? 0;
    const p = prevOf(s, `vac:${k}`, "vac"), ps = prevOf(s, `vac:${k}`, "stock");
    const since = p ? `, ${vac - p.v >= 0 ? "+" : "−"}${Math.abs((vac - p.v) * 100).toFixed(1)} pts since ${monthLabel(p.m)}` : "";
    const built = ps && stock - ps.v > 0 ? ` · ${k$(stock - ps.v)} sf delivered since` : "";
    const pipe = (e.pipeline?.[k] ?? 0) > 0 ? ` · ${k$(e.pipeline[k])} sf being built` : "";
    return {
      k: "market.vacancy", a: "trade", aid: k, name: SECTOR_LABEL[k],
      n: { vac, normal: nv, stock, pipeline: e.pipeline?.[k] ?? 0 },
      t: `${SECTOR_LABEL[k]} availability ${(vac * 100).toFixed(1)}% (normal ${(nv * 100).toFixed(1)}%)${since}${built}${pipe}`,
    };
  }, () => [whyTown(s), whyNation(s)]);
}

/** Once a month, after the month has settled: write what moved past its step. */
export function noteReads(s: GameState): void {
  const e = s.econ;
  if (!e) return;
  const yearly = s.month % 12 === 0;

  // availability, each class
  for (const k of BUILT_CLASSES) {
    const p = prevOf(s, `vac:${k}`, "vac");
    if (!p || yearly || Math.abs(availability(e, k) - p.v) >= 0.005) whyMark(s, `vac:${k}`, whyVacancy(s, k));
  }

  // the apartment rent (the commercial ones are written where their leases are read)
  {
    const r = e.rentIdx?.multifamily ?? 0, p = prevOf(s, "rent:multifamily", "rent");
    if (r > 0 && (!p || (p.v > 0 && Math.abs(r / p.v - 1) >= 0.01))) {
      const ch = p && p.v > 0 ? r / p.v - 1 : 0;
      whyMark(s, "rent:multifamily", why(s, {
        k: "market.rent", a: "trade", aid: "multifamily", name: SECTOR_LABEL.multifamily,
        n: { rent: r, ch },
        t: `Apartment rent $${r.toFixed(2)}/sf a year${p ? `, ${sgnPct(ch)} since ${monthLabel(p.m)}` : ""} · availability ${(availability(e, "multifamily") * 100).toFixed(1)}%`,
      }, [whyAt(s, "vac:multifamily") ?? whyVacancy(s, "multifamily"), whyTown(s), whyNation(s)]));
    }
  }

  // pay in town
  {
    const w = e.wageIdx ?? 0, p = prevOf(s, "wage", "wage");
    if (w > 0 && (!p || yearly || Math.abs(w / p.v - 1) >= 0.015)) {
      const ch = p ? w / p.v - 1 : 0;
      whyMark(s, "wage", why(s, {
        k: "city.pay", a: "city",
        n: { wage: w, ch, unemp: e.unemployment ?? 0, natUnemp: e.nat?.unemp ?? 0 },
        t: `Pay in town ${p ? `${sgnPct(ch)} since ${monthLabel(p.m)}` : `index ${w.toFixed(2)}`} · ${((e.unemployment ?? 0) * 100).toFixed(1)}% jobless here, ${((e.nat?.unemp ?? 0) * 100).toFixed(1)}% nationally`,
      }, [whyTown(s), whyNation(s)]));
    }
  }

  // construction cost: the inputs (prices and pay) and the contractors' markup
  {
    const c = e.costIdx ?? 0, p = prevOf(s, "cost", "cost");
    if (c > 0 && (!p || yearly || Math.abs(c / p.v - 1) >= 0.02)) {
      const ch = p ? c / p.v - 1 : 0, mk = e.gcs?.idx ?? 0;
      const pm = prevOf(s, "cost", "markup");
      const trades = whyTrades(s);
      const markupMoved = pm ? Math.abs(mk - pm.v) : 0;
      const inputs = p ? (c / (1 + mk)) / (p.v / (1 + (pm?.v ?? mk))) - 1 : 0;
      whyMark(s, "cost", why(s, {
        k: "construction.cost", a: "trade", name: "construction",
        n: { cost: c, ch, markup: mk, inputs },
        t: `Construction cost ${p ? `${sgnPct(ch)} since ${monthLabel(p.m)}` : `index ${c.toFixed(2)}`} · materials and labour ${sgnPct(inputs)} · contractors bid ${(mk * 100).toFixed(1)}% over direct cost`,
      }, Math.abs(inputs) > markupMoved ? [whyAt(s, "wage"), trades, whyNation(s)] : [trades, whyAt(s, "wage"), whyNation(s)]));
    }
  }

  // land: the builder's residual — rent against build cost — and how many builders are bidding
  {
    const l = e.landIdx ?? 0, p = prevOf(s, "land", "land");
    if (l > 0 && (!p || yearly || Math.abs(l / p.v - 1) >= 0.03)) {
      const ch = p ? l / p.v - 1 : 0;
      const book = Math.max(0, e.buildDemand ?? 1) / Math.max(1e-6, e.buildNorm ?? e.buildDemand ?? 1);
      const rent = whyAt(s, "rent:office"), cost = whyAt(s, "cost");
      const pr = prevOf(s, "land", "rent"), pc = prevOf(s, "land", "cost");
      const rentNow = e.effRentIdx?.office ?? e.rentIdx.office, costNow = e.costIdx ?? 1;
      const dR = pr ? rentNow / pr.v - 1 : 0, dC = pc ? costNow / pc.v - 1 : 0;
      whyMark(s, "land", why(s, {
        k: "land.month", a: "trade", name: "land",
        n: { land: l, ch, rent: rentNow, cost: costNow, builders: book },
        t: `Land ${p ? `${sgnPct(ch)} since ${monthLabel(p.m)}` : `index ${(l * 100).toFixed(0)}`} · office rent ${sgnPct(dR)}, build cost ${sgnPct(dC)} · builders bidding ${book.toFixed(1)}x a normal year`,
      }, Math.abs(dR) >= Math.abs(dC) ? [rent, cost, whyNation(s)] : [cost, rent, whyNation(s)]));
    }
  }

  // THE INDUSTRIES YOUR RENT RESTS ON (IndustriesView RentExposure): each
  // one's month, once a quarter, so the forward line can say why it moved.
  if (s.month % 3 === 0) {
    const inds = new Set<number>();
    for (const h of Object.values(s.holdings ?? {})) for (const t of h.tenants ?? []) {
      const i = industryOfFirm(s, t);
      if (i !== undefined) inds.add(i);
    }
    for (const i of inds) whyIndustry(s, i);
  }

  // the base rate every loan prices off
  {
    const r = e.indexRate, p = prevOf(s, "rate", "rate");
    if (Number.isFinite(r) && (!p || yearly || Math.abs(r - p.v) >= 0.25)) {
      whyMark(s, "rate", why(s, {
        k: "rate.base", a: "nation",
        n: { rate: r, ch: p ? r - p.v : 0, policy: e.nat?.policy ?? 0 },
        t: `Base rate ${r.toFixed(2)}%${p ? `, ${r - p.v >= 0 ? "+" : "−"}${Math.abs(r - p.v).toFixed(2)} pts since ${monthLabel(p.m)}` : ""} · the central bank at ${(e.nat?.policy ?? 0).toFixed(2)}%`,
      }, [whyNation(s)]));
    }
  }
}
