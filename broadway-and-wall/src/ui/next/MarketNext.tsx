/**
 * MARKET › FOR SALE, AS A TABLE (PLAN §5 step 5). Every listing on the tape
 * with what it earns at its ask and what the market marks it at — the same
 * `inPlace` and `marketAppraisal` the building file prints. Click a row for
 * its file; Pay ask on the row.
 */
import { useMemo, useState } from "react";
import { useStore } from "@/state/store";
import type { GameState } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import { monthLabel } from "@/engine/types";
import { initialCondition, inPlace, marketAppraisal, resolveRec } from "@/engine/value";
import { derive } from "@/ui/derive";
import { usd } from "@/ui/format";
import { Chips, DataTable, Stat, StatStrip, type Col } from "./DataTable";
import { Figure } from "./Figure";

export interface ListingRow {
  bbl: string; addr: string; cls: string; sf: number; lot: number; ask: number; psf: number | null;
  noi: number | null; yld: number | null; value: number; vsValue: number; occ: number | null;
  listedM: number; tag: string; land: boolean; disclosed: boolean;
}

export function listingRows(g: GameState, p: ParcelTable): ListingRow[] {
  return derive(g, "next.listings", () => {
    const out: ListingRow[] = [];
    for (const l of g.listings) {
      if (g.holdings[l.bbl]) continue;
      const rec = resolveRec(p, g, l.bbl);
      if (!rec) continue;
      const land = rec.class === "land" || !rec.bldgArea;
      const ip = inPlace(rec, g, l.bbl, l.ask);
      const value = marketAppraisal(g, rec, l.bbl, initialCondition(rec));
      const tag = l.reason === "receiver" ? "bank" : l.distress ? "distress" : l.earlyUntilM !== undefined && g.month < l.earlyUntilM ? "first look" : g.watch?.includes(l.bbl) ? "watched" : "";
      out.push({
        bbl: l.bbl, addr: rec.address || l.bbl, cls: rec.class, sf: rec.bldgArea, lot: rec.lotArea, ask: l.ask,
        psf: !land && rec.bldgArea ? l.ask / rec.bldgArea : null,
        noi: land ? null : ip.noi, yld: land || l.ask <= 0 ? null : ip.noi / l.ask,
        value, vsValue: l.ask > 0 ? value / l.ask - 1 : 0, occ: land ? null : ip.occ,
        listedM: l.listedM, tag, land, disclosed: ip.disclosed,
      });
    }
    return out;
  }, [p]);
}

type F = "y8" | "under" | "land" | "bldg" | "distress";

export function MarketForSale() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const sel = useStore((s) => s.selectedBBL);
  const rows = useMemo(() => listingRows(game, parcels), [game, parcels]);
  const [f, setF] = useState<F[]>([]);
  const tests: Record<F, (r: ListingRow) => boolean> = {
    y8: (r) => (r.yld ?? 0) >= 0.08,
    under: (r) => r.vsValue > 0,
    land: (r) => r.land,
    bldg: (r) => !r.land,
    distress: (r) => r.tag === "bank" || r.tag === "distress",
  };
  const shown = rows.filter((r) => f.every((k) => tests[k](r)));
  const n = (k: F) => rows.filter(tests[k]).length;
  const yields = rows.filter((r) => r.yld !== null).map((r) => r.yld!);
  const med = yields.length ? yields.slice().sort((a, b) => a - b)[Math.floor(yields.length / 2)] : null;
  const cols: Col<ListingRow>[] = [
    { id: "addr", label: "Address", get: (r) => r.addr, cell: (r) => <span className="nx-strong-cell">{r.addr}</span> },
    { id: "cls", label: "Use", get: (r) => r.cls },
    { id: "sf", label: "sf", get: (r) => (r.land ? r.lot : r.sf), fmt: "n" },
    { id: "ask", label: "Ask", get: (r) => r.ask, fmt: "usd" },
    { id: "psf", label: "$/sf", get: (r) => r.psf, fmt: "psf" },
    { id: "noi", label: "NOI", get: (r) => r.noi, fmt: "usd", tone: (r) => ((r.noi ?? 0) < 0 ? "neg" : undefined) },
    { id: "yld", label: "Yield", get: (r) => r.yld, fmt: "pct", tone: (r) => ((r.yld ?? 0) >= 0.08 ? "pos" : (r.yld ?? 0) < 0 ? "neg" : undefined) },
    { id: "value", label: "Value", get: (r) => r.value, fmt: "usd" },
    { id: "vs", label: "vs ask", get: (r) => r.vsValue, fmt: "pct", tone: (r) => (r.vsValue >= 0 ? "pos" : "neg") },
    { id: "occ", label: "Occ", get: (r) => r.occ, fmt: "pct" },
    { id: "roll", label: "Roll", get: (r) => (r.land ? "" : r.disclosed ? "disclosed" : "est."), hidden: true },
    { id: "listed", label: "Listed", get: (r) => r.listedM, cell: (r) => <span className="mono">{monthLabel(r.listedM)}</span> },
    { id: "tag", label: "Tag", get: (r) => r.tag },
  ];
  return (
    <div className="nx-place">
      <StatStrip>
        <Stat label="Listings"><Figure value={rows.length} fmt="n" /></Stat>
        <Stat label="Buildings"><Figure value={n("bldg")} fmt="n" /></Stat>
        <Stat label="Lots"><Figure value={n("land")} fmt="n" /></Stat>
        <Stat label="Median yield"><Figure value={med} fmt="pct" /></Stat>
        <Stat label="Under value"><Figure value={n("under")} fmt="n" /></Stat>
        <Stat label="10Y"><Figure value={game.econ.indexRate} fmt="pctv" drill="rate" /></Stat>
      </StatStrip>
      <Chips<F>
        chips={[
          { id: "y8", label: "Yield ≥ 8%", n: n("y8") },
          { id: "under", label: "Below value", n: n("under") },
          { id: "bldg", label: "Buildings", n: n("bldg") },
          { id: "land", label: "Lots", n: n("land") },
          { id: "distress", label: "Distress", n: n("distress") },
        ]}
        on={f}
        set={setF}
      />
      <DataTable
        id="market-forsale"
        cols={cols}
        rows={shown}
        rowKey={(r) => r.bbl}
        selected={sel}
        initialSort={{ col: "yld", dir: -1 }}
        onRow={(r) => useStore.getState().select(r.bbl)}
        actions={(r) => (
          <button type="button" className="nx-btn nx-sm" title={usd(r.ask)}
            onClick={() => { const st = useStore.getState(); st.select(r.bbl); st.offer(r.bbl, r.ask, false); }}>
            Pay ask
          </button>
        )}
      />
    </div>
  );
}
