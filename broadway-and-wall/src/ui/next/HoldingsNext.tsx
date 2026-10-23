/**
 * HOLDINGS › BUILDINGS AND LAND, AS TABLES (PLAN §5 step 5, §3.3).
 *
 * Buildings: one row per deed, every figure the building file prints for it
 * (`ownedHoldingNoiYr`, `ownedHoldingValue`, `dscr`, `occupancyRead`, `walt`).
 * Land: the region's tracts by stage — farm, at the board, entitled, streets
 * going in, lots — with the board's date and odds, the plat's finish, the
 * builder's offer and the contract, all read off the engine's records
 * (landdev.ts, homes.ts).
 */
import { useMemo } from "react";
import { useStore } from "@/state/store";
import type { GameState } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import { monthLabel } from "@/engine/types";
import { ownedHoldingNoiYr, ownedHoldingValue, resolveRec } from "@/engine/value";
import { occupancyRead, portfolioOccupancy, walt } from "@/engine/leasing";
import { dscr } from "@/engine/debt";
import { platLots } from "@/engine/homes";
import { derive } from "@/ui/derive";
import { usd } from "@/ui/format";
import { DataTable, Stat, StatStrip, type Col } from "./DataTable";
import { Figure } from "./Figure";
import { debtBook, firmCfMonthly } from "./derive";

// ---------------------------------------------------------------- buildings
interface BldgRow {
  bbl: string; addr: string; cls: string; sf: number; occ: number | null; rent: number | null; noi: number; value: number;
  debt: number; dscr: number | null; cfMo: number; walt: number | null; listed: boolean; land: boolean; job: boolean; doneM: number | null;
}

function bldgRows(g: GameState, p: ParcelTable): BldgRow[] {
  return derive(g, "next.bldgRows", () => {
    const out: BldgRow[] = [];
    for (const h of Object.values(g.holdings)) {
      if (g.merged?.[h.bbl]) continue;
      const rec = resolveRec(p, g, h.bbl);
      if (!rec) continue;
      const land = rec.class === "land" || !rec.bldgArea;
      const leased = h.tenants.reduce((a, t) => a + t.sf, 0);
      const noi = ownedHoldingNoiYr(g, p, h);
      const ds = ((h.loan?.monthlyPmt ?? 0) + (h.mezz?.monthlyPmt ?? 0)) * 12;
      out.push({
        bbl: h.bbl, addr: rec.address || h.bbl, cls: rec.class, sf: land ? rec.lotArea : rec.bldgArea,
        occ: land || h.groundLeased ? null : occupancyRead(rec, h).lettableOcc,
        rent: leased > 0 ? h.tenants.reduce((a, t) => a + t.sf * t.rentPsf, 0) / leased : null,
        noi, value: ownedHoldingValue(g, p, h), debt: (h.loan?.balance ?? 0) + (h.mezz?.balance ?? 0),
        dscr: h.loan ? dscr(rec, g, h) : null, cfMo: (noi - ds) / 12,
        walt: h.tenants.length ? walt(h, g.month) : null, listed: !!h.sale, land, job: !!g.developments[h.bbl], doneM: g.developments[h.bbl]?.deliverM ?? null,
      });
    }
    return out;
  }, [p]);
}

const bcols: Col<BldgRow>[] = [
  { id: "addr", label: "Address", get: (r) => r.addr, cell: (r) => <span className="nx-strong-cell">{r.addr}{r.listed ? <span className="nx-chip nx-chip-teal">Listed</span> : null}{r.job ? <span className="nx-chip nx-chip-gold">Under construction</span> : null}</span> },
  { id: "cls", label: "Use", get: (r) => r.cls },
  // a job in the ground: the month it is due to deliver (it slips when the job does)
  { id: "done", label: "Completes", get: (r) => r.doneM, cell: (r) => <span className="mono">{r.doneM === null ? "—" : monthLabel(r.doneM)}</span> },
  { id: "sf", label: "sf", get: (r) => r.sf, fmt: "n" },
  { id: "occ", label: "Occ", get: (r) => r.occ, fmt: "pct", tone: (r) => (r.occ !== null && r.occ < 0.75 ? "neg" : undefined) },
  { id: "rent", label: "Rent", get: (r) => r.rent, fmt: "psf" },
  { id: "noi", label: "NOI", get: (r) => r.noi, fmt: "usd", tone: (r) => (r.noi < 0 ? "neg" : undefined) },
  { id: "value", label: "Value", get: (r) => r.value, fmt: "usd" },
  { id: "cap", label: "Cap", get: (r) => (r.value > 0 && !r.land ? r.noi / r.value : null), fmt: "pct", hidden: true },
  { id: "debt", label: "Debt", get: (r) => r.debt, fmt: "usd" },
  { id: "ltv", label: "LTV", get: (r) => (r.value > 0 && r.debt > 0 ? r.debt / r.value : null), fmt: "pct", hidden: true },
  { id: "dscr", label: "DSCR", get: (r) => r.dscr, fmt: "x", tone: (r) => (r.dscr !== null && r.dscr < 1.2 ? "neg" : undefined) },
  { id: "cf", label: "CF / mo", get: (r) => r.cfMo, fmt: "usd", tone: (r) => (r.cfMo < 0 ? "neg" : undefined) },
  { id: "walt", label: "WALT", get: (r) => r.walt, fmt: "x", cell: (r) => <span>{r.walt !== null ? r.walt.toFixed(1) + " y" : "—"}</span> },
];

export function HoldingsBuildings() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const rows = useMemo(() => bldgRows(game, parcels), [game, parcels]);
  const occ = useMemo(() => portfolioOccupancy(game, parcels), [game, parcels]);
  const value = rows.reduce((a, r) => a + r.value, 0);
  const noi = rows.reduce((a, r) => a + r.noi, 0);
  const debt = debtBook(game).secured;
  return (
    <div className="nx-place">
      <StatStrip>
        <Stat label="Deeds"><Figure value={rows.length} fmt="n" /></Stat>
        {rows.some((r) => r.job) && <Stat label="Building"><Figure value={rows.filter((r) => r.job).length} fmt="n" /></Stat>}
        <Stat label="Value"><Figure value={value} fmt="usd" drill="nw" /></Stat>
        <Stat label="NOI"><Figure value={noi} fmt="usd" drill="cf" /></Stat>
        <Stat label="Cap"><Figure value={value > 0 ? noi / value : null} fmt="pct" /></Stat>
        <Stat label="Debt"><Figure value={debt} fmt="usd" drill="debt" /></Stat>
        <Stat label="LTV"><Figure value={value > 0 ? debt / value : null} fmt="pct" drill="debt" /></Stat>
        <Stat label="Occ"><Figure value={occ?.occ ?? null} fmt="pct" drill="occ" /></Stat>
        <Stat label="CF / mo"><Figure value={firmCfMonthly(game, parcels)} fmt="usd" drill="cf" /></Stat>
      </StatStrip>
      <DataTable id="holdings-bldgs" cols={bcols} rows={rows} rowKey={(r) => r.bbl} initialSort={{ col: "value", dir: -1 }} empty="No deeds"
        onRow={(r) => useStore.getState().select(r.bbl)} />
    </div>
  );
}

// ---------------------------------------------------------------- land
export type LandStage = "farm" | "board" | "entitled" | "streets" | "lots";
export interface LandRow {
  /** acres: the tract's gross land, every stage; lotAcres: what its lots cover, once platted (net of streets, pond, open space) */
  key: string; bbl: string; addr: string; stage: LandStage; acres: number; lotAcres: number | null; lots: number | null;
  when: number | null; odds: number | null; cost: number | null;
  owned: number | null; listed: number | null; sold: number | null; proceeds: number | null;
  offer: string | null; contract: string | null;
}

/** The player's land-development book, tract by tract. Exported for the Inbox and Pipeline. */
export function landRows(g: GameState, p: ParcelTable): LandRow[] {
  return derive(g, "next.landRows", () => {
    const out: LandRow[] = [];
    const seen = new Set<string>();
    const acres = (sf: number) => sf / 43_560;
    for (const h of Object.values(g.holdings)) {
      const rec = p[h.bbl];
      if (!rec?.tract) continue;
      seen.add(h.bbl);
      const app = g.entitlementApps?.[h.bbl];
      const rz = g.rezoned?.[h.bbl];
      const plat = g.plats?.[h.bbl];
      const stage: LandStage = plat ? "streets" : app ? "board" : rz ? "entitled" : "farm";
      out.push({
        key: h.bbl, bbl: h.bbl, addr: rec.address || h.bbl, stage, acres: acres(rec.lotArea),
        lotAcres: plat ? acres(plat.lots.reduce((a, l) => a + l.a, 0)) : null,
        lots: plat ? plat.lots.length : app ? app.lots : null,
        when: plat ? plat.doneM : app ? app.decideM : rz ? rz.m : null,
        odds: app ? app.odds : null, cost: plat ? plat.cost : app ? app.cost : null,
        owned: null, listed: null, sold: null, proceeds: null, offer: null, contract: null,
      });
    }
    // finished plats: the tract is gone, its lots are deeds
    for (const plat of Object.values(g.plats ?? {})) {
      if (!plat.done || seen.has(plat.parent)) continue;
      const lots = platLots(g, p, plat.parent);
      const mine = lots.filter((b) => g.holdings[b]);
      const offer = g.homes?.offers?.[plat.parent];
      const con = g.homes?.contracts?.[plat.parent];
      const pl = g.homes?.pl?.[plat.parent];
      if (!mine.length && !con && !offer) continue;
      out.push({
        key: plat.parent, bbl: mine[0] ?? plat.parent, addr: p[plat.parent]?.address ?? plat.parent, stage: "lots",
        // the tract's gross acres, as at every other stage; the lots' own area is lotAcres
        acres: acres(p[plat.parent]?.lotArea ?? plat.lots.reduce((a, l) => a + l.a, 0)),
        lotAcres: acres(plat.lots.reduce((a, l) => a + l.a, 0)), lots: plat.lots.length, when: plat.doneM, odds: null, cost: plat.cost,
        owned: mine.length, listed: mine.filter((b) => g.holdings[b]?.sale).length,
        sold: pl?.lotsSold ?? 0, proceeds: pl?.lotProceeds ?? 0,
        offer: offer ? `${offer.lots} @ $${offer.psf.toFixed(0)}/sf` : null,
        contract: con ? `${con.taken}/${con.taken + con.left} @ $${con.psf.toFixed(0)}` : null,
      });
    }
    return out;
  }, [p]);
}

const STAGE_LABEL: Record<LandStage, string> = { farm: "Farm", board: "Board", entitled: "Entitled", streets: "Streets", lots: "Lots" };
const lcols: Col<LandRow>[] = [
  { id: "addr", label: "Tract", get: (r) => r.addr, cell: (r) => <span className="nx-strong-cell">{r.addr}</span> },
  { id: "stage", label: "Stage", get: (r) => ["farm", "board", "entitled", "streets", "lots"].indexOf(r.stage), cell: (r) => <span className={"nx-stage nx-stage-" + r.stage}>{STAGE_LABEL[r.stage]}</span> },
  { id: "acres", label: "Acres", get: (r) => r.acres, fmt: "n", cell: (r) => <span>{r.acres.toFixed(1)}</span> },
  { id: "lotac", label: "Lot ac", get: (r) => r.lotAcres, fmt: "n", cell: (r) => <span>{r.lotAcres !== null ? r.lotAcres.toFixed(1) : "—"}</span>, hidden: true },
  { id: "lots", label: "Lots", get: (r) => r.lots, fmt: "n" },
  { id: "when", label: "Date", get: (r) => r.when, cell: (r) => <span className="mono">{r.when !== null ? monthLabel(r.when) : "—"}</span> },
  { id: "odds", label: "Odds", get: (r) => r.odds, fmt: "pct" },
  { id: "cost", label: "Spent", get: (r) => r.cost, fmt: "usd" },
  { id: "owned", label: "Held", get: (r) => r.owned, fmt: "n" },
  { id: "listed", label: "Listed", get: (r) => r.listed, fmt: "n" },
  { id: "sold", label: "Sold", get: (r) => r.sold, fmt: "n" },
  { id: "proceeds", label: "Proceeds", get: (r) => r.proceeds, fmt: "usd" },
  { id: "offer", label: "Offer", get: (r) => r.offer, tone: (r) => (r.offer ? "pos" : undefined) },
  { id: "contract", label: "Contract", get: (r) => r.contract },
];

export function HoldingsLand() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const rows = useMemo(() => landRows(game, parcels), [game, parcels]);
  const n = (st: LandStage) => rows.filter((r) => r.stage === st).length;
  const lotsHeld = rows.reduce((a, r) => a + (r.owned ?? 0), 0);
  const proceeds = rows.reduce((a, r) => a + (r.proceeds ?? 0), 0);
  return (
    <div className="nx-place">
      <StatStrip>
        <Stat label="Farms"><Figure value={n("farm")} fmt="n" /></Stat>
        <Stat label="At board"><Figure value={n("board")} fmt="n" /></Stat>
        <Stat label="Entitled"><Figure value={n("entitled")} fmt="n" /></Stat>
        <Stat label="Streets"><Figure value={n("streets")} fmt="n" /></Stat>
        <Stat label="Lots held"><Figure value={lotsHeld} fmt="n" /></Stat>
        <Stat label="Lot sales"><Figure value={proceeds} fmt="usd" text={usd(proceeds)} /></Stat>
      </StatStrip>
      <DataTable id="holdings-land" cols={lcols} rows={rows} rowKey={(r) => r.key} initialSort={{ col: "stage", dir: 1 }} empty="No land"
        onRow={(r) => useStore.getState().select(r.bbl)}
        actions={(r) => {
          const offer = r.stage === "lots" ? game.homes?.offers?.[r.key] : undefined;
          return offer ? (
            <span className="nx-row-verbs">
              <button type="button" className="nx-btn nx-sm nx-primary" onClick={() => useStore.getState().takeLotOffer(r.key)}>Take</button>
              <button type="button" className="nx-btn nx-sm" onClick={() => useStore.getState().refuseLotOffer(r.key)}>Refuse</button>
            </span>
          ) : null;
        }} />
    </div>
  );
}
