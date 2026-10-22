/**
 * EVERY NUMBER DRILLS (PLAN R3, BUILD_SPEC 4.2).
 *
 * A drill is the figure's inputs and the arithmetic, read from the same
 * engine functions the figure itself came from. If the engine does not
 * compute a line, the line is not here.
 */
import type { GameState, Holding } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import { monthLabel } from "@/engine/types";
import {
  appraise, capRateFor, incomeValueAsIs, initialCondition, inPlace, landRead, marketAppraisal,
  marketRentPsfYr, operatingStatement, ownedHoldingNoiYr, resolveRec,
} from "@/engine/value";
import { replacementCost } from "@/engine/dev";
import { buildBalanceSheet } from "@/engine/books";
import { firmOverheadMonthly, portfolioMonthlyCF } from "@/engine/sim";
import { occupancyRead, portfolioOccupancy } from "@/engine/leasing";
import { dscr as dscrOf } from "@/engine/debt";
import { standingOf } from "@/ui/derive";
import { buildModel } from "@/ui/vitals/Waterfall";
import { useStore } from "@/state/store";
import { usd, pct, sf } from "@/ui/format";
import { debtBook } from "./derive";

export type DrillKey = "cash" | "debt" | "nw" | "cf" | "rank" | "occ" | "rate" | "noi" | "cap" | "value" | "land" | "rent" | "dscr";
export type Tone = "pos" | "neg";
export interface DrillRow { label: string; value: string; tone?: Tone; strong?: boolean }
export interface DrillResult {
  title: string;
  total: string;
  rows: DrillRow[];
  formula?: string;
  series?: { label: string; pts: number[] };
  link?: { label: string; go: () => void };
}
export type DrillArgs = { bbl?: string; price?: number } & Record<string, unknown>;

const neg = (n: number): DrillRow["tone"] => (n < 0 ? "neg" : undefined);
const row = (label: string, n: number, opts: Partial<DrillRow> = {}): DrillRow => ({ label, value: usd(n), tone: neg(n), ...opts });
const st = () => useStore.getState();
const addr = (p: ParcelTable, bbl: string) => p[bbl]?.address ?? bbl;

function recOf(g: GameState, p: ParcelTable, bbl?: string) {
  if (!bbl) return null;
  const rec = resolveRec(p, g, bbl);
  if (!rec) return null;
  const h: Holding | undefined = g.holdings[bbl];
  return { rec, h, cond: h?.condition ?? initialCondition(rec) };
}

const none = (title: string): DrillResult => ({ title, total: "—", rows: [] });

export const DRILLS: Record<DrillKey, (g: GameState, p: ParcelTable, a: DrillArgs) => DrillResult> = {
  cash(g, p) {
    const m = buildModel(g, st().prevForDigest, p);
    return {
      title: "Cash",
      total: usd(g.cash),
      rows: [...m.cashRows.map((r) => row(r.label, r.amount)), row("Net · " + m.windowLabel, m.cashNet, { strong: true })],
      link: { label: "Books", go: () => st().setPage("books") },
    };
  },

  debt(g, p) {
    const b = debtBook(g);
    return {
      title: "Debt",
      total: usd(b.total),
      rows: [
        ...b.rows.map((r) => ({
          label: `${r.bbl ? addr(p, r.bbl) : r.lender} · ${r.kind}`,
          value: `${usd(r.balance)} · ${pct(r.rate)}${r.maturesM !== undefined ? " · " + monthLabel(r.maturesM) : ""}`,
        })),
        row("Due ≤ 3 yrs", b.wall, { strong: true }),
      ],
      link: { label: "Loans", go: () => st().setPage("debt", "Loan by loan") },
    };
  },

  nw(g, p) {
    const b = buildBalanceSheet(g, p);
    const rows: DrillRow[] = [];
    for (const [cls, v] of Object.entries(b.byClass)) rows.push(row(`${cls} · ${v.n}`, v.gross));
    if (b.landOnly) rows.push(row(`land · ${b.landCount}`, b.landOnly));
    if (b.cip) rows.push(row(`Building · ${b.cipN}`, b.cip));
    if (b.notesVal) rows.push(row(`Notes · ${b.noteCount}`, b.notesVal));
    if (b.fundInterest) rows.push(row("Fund interest", b.fundInterest));
    rows.push(row("Cash", b.cash));
    rows.push(row("Assets", b.totalAssets, { strong: true }));
    rows.push(row("Mortgages", -b.mortgages));
    if (b.cipDebt) rows.push(row("Construction", -b.cipDebt));
    if (b.mezz) rows.push(row("Mezz", -b.mezz));
    if (b.facility) rows.push(row("Facility", -b.facility));
    if (b.locBal) rows.push(row("Line", -b.locBal));
    if (b.partners) rows.push(row("Partners", -b.partners));
    if (b.deposits) rows.push(row("Tenant deposits", -b.deposits));
    rows.push(row("Liabilities", -b.totalLiab, { strong: true }));
    return {
      title: "Net worth",
      total: usd(b.equity),
      rows,
      formula: "assets − liabilities = equity",
      series: { label: "NW", pts: (g.nwHistory ?? []).slice(-60) },
      link: { label: "Balance sheet", go: () => st().setPage("books") },
    };
  },

  cf(g, p) {
    const prop = portfolioMonthlyCF(g, p) * 12;
    const ga = firmOverheadMonthly(g, p) * 12;
    const m = buildModel(g, st().prevForDigest, p);
    return {
      title: "Cash flow / yr",
      total: usd(prop - ga),
      rows: [
        row("Deeds after debt", prop),
        row("Firm overhead", -ga),
        { label: "Cash · " + m.windowLabel, value: "", strong: true },
        ...m.cashRows.map((r) => row(r.label, r.amount)),
      ],
      formula: "(deed CF − overhead) × 12",
      link: { label: "Books", go: () => st().setPage("books") },
    };
  },

  rank(g, p) {
    if (!(g.rivals?.length)) return none("Rank");
    const s = standingOf(g, p);
    return {
      title: "Rank",
      total: `${s.rank} of ${s.of}`,
      rows: [
        row("Your equity", s.equity, { strong: true }),
        row(`Leader · ${s.leader.name}`, s.leader.eq),
        ...(s.above ? [row(`Above · ${s.above.name}`, s.above.eq)] : []),
        row("Median rival", s.medianRival),
      ],
      link: { label: "Rankings", go: () => st().setPage("players") },
    };
  },

  occ(g, p) {
    const o = portfolioOccupancy(g, p);
    if (!o) return none("Occupancy");
    const rows: DrillRow[] = [];
    for (const h of Object.values(g.holdings)) {
      const rec = resolveRec(p, g, h.bbl);
      if (!rec || rec.class === "land" || !rec.bldgArea || h.groundLeased || g.merged?.[h.bbl]) continue;
      const r = occupancyRead(rec, h);
      rows.push({ label: addr(p, h.bbl), value: `${(r.lettableOcc * 100).toFixed(0)}%`, tone: r.lettableOcc < 0.75 ? "neg" : undefined });
    }
    rows.sort((a, b) => parseFloat(a.value) - parseFloat(b.value));
    rows.push({ label: "Leased", value: sf(o.leasedSf), strong: true }, { label: "Lettable", value: sf(o.lettableSf), strong: true });
    return {
      title: "Occupancy",
      total: `${(o.occ * 100).toFixed(1)}%`,
      rows,
      formula: "leased sf ÷ lettable sf",
      link: { label: "Leasing", go: () => st().setPage("leasing") },
    };
  },

  rate(g, _p, a) {
    const e = g.econ;
    const hist = e.history ?? [];
    const ln = a.bbl ? g.holdings[a.bbl]?.loan : undefined;
    return {
      title: ln ? "Coupon" : "10-year index",
      total: pct(ln ? ln.ratePct : e.indexRate),
      rows: [
        { label: "Loan index", value: pct(e.indexRate), strong: true },
        { label: "Short index", value: pct(e.shortIndex ?? e.indexRate) },
        { label: "Policy", value: pct(e.nat?.policy ?? e.indexRate) },
        { label: "Phase", value: String(e.phase) },
        ...(ln ? [
          { label: ln.floating ? "Floating · spread" : "Fixed", value: ln.floating ? pct(ln.spread) : "—" },
          { label: "Coupon", value: pct(ln.ratePct), strong: true },
        ] : []),
      ],
      series: { label: "10Y", pts: hist.slice(-120).map((h) => h.indexRate ?? NaN).filter(Number.isFinite) },
      link: { label: "Markets", go: () => st().setPage("economy") },
    };
  },

  noi(g, p, a) {
    const r = recOf(g, p, a.bbl);
    if (!r || !a.bbl) return none("NOI");
    const price = a.price ?? marketAppraisal(g, r.rec, a.bbl, r.cond);
    const ip = inPlace(r.rec, g, a.bbl, price);
    if (r.h && !r.h.groundLeased) {
      const os = operatingStatement(r.rec, g.econ, r.h, g.month);
      return {
        title: "NOI / yr",
        total: usd(ownedHoldingNoiYr(g, p, r.h)),
        rows: [
          row("Base rent", os.baseRent),
          row("Recovered opex", os.recoveredOpex),
          row("Recovered tax", os.recoveredTax),
          row("EGI", os.egi, { strong: true }),
          row("Opex", -os.opex),
          row("Management", -os.mgmt),
          row("Reserves", -os.reserve),
          row("Property tax", -os.tax),
          ...(os.groundRent ? [row("Ground rent", -os.groundRent)] : []),
          row("Cash NOI", os.noi, { strong: true }),
          ...(os.freeRent ? [row("Free rent", os.freeRent)] : []),
          row("Contract NOI", ip.noi, { strong: true }),
        ],
        formula: "EGI − opex − mgmt − reserves − tax",
        link: { label: "Rent roll", go: () => st().openProperty(a.bbl!, "leasing") },
      };
    }
    return {
      title: "NOI / yr",
      total: usd(ip.noi),
      rows: [
        row("In-place NOI", ip.noi, { strong: true }),
        { label: "Occupancy", value: `${(ip.occ * 100).toFixed(0)}%` },
        { label: "Roll", value: ip.disclosed ? "disclosed" : "estimated" },
        row("Price", price),
        { label: "Going-in", value: price > 0 ? pct((ip.noi / price) * 100) : "—", strong: true },
      ],
      formula: "NOI ÷ price = going-in",
    };
  },

  cap(g, p, a) {
    const r = recOf(g, p, a.bbl);
    if (!r || !a.bbl) return none("Cap rate");
    const price = a.price ?? marketAppraisal(g, r.rec, a.bbl, r.cond);
    const ip = inPlace(r.rec, g, a.bbl, price);
    const mkt = capRateFor(r.rec, g.econ, r.cond);
    return {
      title: "Cap rate",
      total: price > 0 ? pct((ip.noi / price) * 100) : "—",
      rows: [
        row("NOI", ip.noi),
        row("Price", price),
        { label: "Market cap", value: pct(mkt), strong: true },
      ],
      formula: "NOI ÷ price",
    };
  },

  value(g, p, a) {
    const r = recOf(g, p, a.bbl);
    if (!r || !a.bbl) return none("Value");
    const mark = marketAppraisal(g, r.rec, a.bbl, r.cond);
    const ip = inPlace(r.rec, g, a.bbl, mark);
    const band = appraise(a.bbl, mark);
    const rc = replacementCost(r.rec, g.econ);
    return {
      title: "Value",
      total: usd(mark),
      rows: [
        row("NOI", ip.noi),
        { label: "Market cap", value: pct(capRateFor(r.rec, g.econ, r.cond)) },
        row("Income value", incomeValueAsIs(r.rec, g.econ, r.cond)),
        { label: "Appraisal band", value: `${usd(band.lo)} – ${usd(band.hi)}` },
        ...(rc ? [row("Replacement cost", rc), { label: "Value ÷ cost", value: `${(mark / rc).toFixed(2)}×` }] : []),
        row("Mark", mark, { strong: true }),
      ],
      link: r.h ? { label: "Money tab", go: () => st().openProperty(a.bbl!, "money") } : undefined,
    };
  },

  land(g, p, a) {
    const r = recOf(g, p, a.bbl);
    if (!r || !a.bbl) return none("Land value");
    const lr = landRead(r.rec, g.econ);
    const s = lr.scheme;
    const lot = r.rec.lotArea;
    return {
      title: "Land value",
      total: usd(lr.psf * lot),
      rows: [
        { label: "Land $/sf", value: `$${lr.psf.toFixed(0)}`, strong: true },
        ...(s ? [
          { label: "Best use", value: `${s.use} · ${s.floors} fl · ${Math.round(s.coverage * 100)}%` },
          { label: "Finished $/sf", value: `$${s.valuePsf.toFixed(0)}` },
          { label: "Cost $/sf", value: `$${s.costPsf.toFixed(0)}` },
          { label: "Residual $/sf", value: `$${s.psf.toFixed(0)}` },
        ] : []),
        { label: "Builder bid", value: `$${lr.builder.toFixed(0)}/sf`, tone: lr.winner === "builder" ? "pos" : undefined },
        { label: "Holder bid", value: `$${lr.holder.toFixed(0)}/sf`, tone: lr.winner === "holder" ? "pos" : undefined },
        { label: "Texture bid", value: `$${lr.texture.toFixed(0)}/sf`, tone: lr.winner === "texture" ? "pos" : undefined },
        { label: "Winner", value: lr.winner, strong: true },
        { label: "Lot", value: sf(lot) },
      ],
      formula: "residual = finished − cost, less margin, per land sf",
      link: r.h ? { label: "Build tab", go: () => st().openProperty(a.bbl!, "build") } : undefined,
    };
  },

  rent(g, p, a) {
    const r = recOf(g, p, a.bbl);
    if (!r || !a.bbl) return none("Rent");
    const mkt = marketRentPsfYr(r.rec, g.econ, r.cond);
    // Yours: the roll. For sale: the roll the seller discloses (inPlace), if any.
    const h = r.h ?? inPlace(r.rec, g, a.bbl, a.price ?? marketAppraisal(g, r.rec, a.bbl, r.cond)).h;
    const ten = h?.tenants ?? [];
    const rows: DrillRow[] = ten
      .slice()
      .sort((x, y) => y.sf - x.sf)
      .slice(0, 14)
      .map((t) => ({ label: t.name, value: `$${t.rentPsf.toFixed(2)} · ${sf(t.sf)} · ${monthLabel(t.endM)}`, tone: t.rentPsf < mkt * 0.9 ? "neg" : undefined }));
    const leased = ten.reduce((s0, t) => s0 + t.sf, 0);
    const avg = leased > 0 ? ten.reduce((s0, t) => s0 + t.sf * t.rentPsf, 0) / leased : null;
    if (avg !== null) rows.push({ label: "In place avg", value: `$${avg.toFixed(2)}`, strong: true });
    rows.push({ label: "Market", value: `$${mkt.toFixed(2)}`, strong: true });
    return {
      title: "Rent / sf",
      total: avg !== null ? `$${avg.toFixed(2)}` : `$${mkt.toFixed(2)}`,
      rows,
      series: { label: "Market", pts: (g.econ.history ?? []).slice(-60).map((x) => x.rent?.[r.rec.class as keyof NonNullable<typeof x.rent>] ?? NaN).filter(Number.isFinite) },
      link: r.h ? { label: "Rent roll", go: () => st().openProperty(a.bbl!, "leasing") } : undefined,
    };
  },

  dscr(g, p, a) {
    const r = recOf(g, p, a.bbl);
    if (!r || !r.h?.loan) return none("DSCR");
    const d = dscrOf(r.rec, g, r.h);
    const ds = r.h.loan.monthlyPmt * 12;
    return {
      title: "DSCR",
      total: d === null ? "—" : `${d.toFixed(2)}×`,
      rows: [
        row("NOI", ownedHoldingNoiYr(g, p, r.h)),
        row("Debt service", -ds),
        { label: "Covenant", value: `${r.h.loan.minDSCR.toFixed(2)}×`, strong: true },
        { label: "Coupon", value: pct(r.h.loan.ratePct) },
      ],
      formula: "NOI ÷ debt service",
      link: { label: "Money tab", go: () => st().openProperty(a.bbl!, "money") },
    };
  },
};
