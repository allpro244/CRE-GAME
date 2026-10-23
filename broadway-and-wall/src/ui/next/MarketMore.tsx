/**
 * MARKET › SITES, DISTRESSED, BOOKS, AS TABLES (PLAN §3.1, §5 step 5).
 *
 * Sites: every vacant lot on the tape and every unlisted one that pencils,
 * priced against what a builder can pay for it (`landRead`, `sitesThatPencil`
 * — the classic Site finder's own reads). Distressed: the pipeline from watch
 * to the courthouse — bank-owned listings, notices of sale, workouts, watch
 * loans, the docket and the notes desks are selling. Books: whole portfolios
 * for sale, underwritten by `streetBookStats`.
 */
import { useMemo, useState } from "react";
import { useStore } from "@/state/store";
import type { GameState } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import { monthLabel } from "@/engine/types";
import { landRead, resolveRec } from "@/engine/value";
import { sitesThatPencil } from "@/engine/buybox";
import { spendable } from "@/engine/credit";
import { streetBookStats } from "@/engine/portfoliosale";
import { derive, ownerName } from "@/ui/derive";
import { usd } from "@/ui/format";
import { Chips, DataTable, Stat, StatStrip, type Col } from "./DataTable";
import { Figure } from "./Figure";
import { dealAct } from "./deal";

const mo = (m: number | null | undefined) => <span className="mono">{m !== null && m !== undefined ? monthLabel(m) : "—"}</span>;
const strong = (s: string) => <span className="nx-strong-cell">{s}</span>;

// ---------------------------------------------------------------- sites
interface SiteRow { bbl: string; addr: string; lot: number; price: number; listed: boolean; pay: number; ratio: number | null; use: string; floors: number | null; owner: string }

function siteRows(g: GameState, p: ParcelTable): { rows: SiteRow[]; vacant: number; pencil: number } {
  return derive(g, "next.sites", () => {
    const rows: SiteRow[] = [];
    let vacant = 0, pencil = 0;
    const asks = new Map(g.listings.map((l) => [l.bbl, l.ask] as const));
    for (const bbl of Object.keys(p)) {
      if (g.holdings[bbl]) continue;
      const rec = resolveRec(p, g, bbl);
      if (!rec || rec.class !== "land" || !rec.lotArea || rec.tract) continue;
      vacant++;
      const read = landRead(rec, g.econ);
      const pay = Math.max(0, read.builder) * rec.lotArea;
      if (pay > 0 && pay >= read.psf * rec.lotArea) pencil++;
      const ask = asks.get(bbl);
      if (ask === undefined) continue;
      rows.push({ bbl, addr: rec.address || bbl, lot: rec.lotArea, price: ask, listed: true, pay, ratio: ask > 0 && pay > 0 ? pay / ask : null, use: read.scheme?.use ?? "", floors: read.scheme?.floors ?? null, owner: "" });
    }
    for (const s of sitesThatPencil(g, p, 999)) {
      if (asks.has(s.bbl) || g.holdings[s.bbl]) continue;
      const pay = s.builderPsf * s.lotArea;
      rows.push({ bbl: s.bbl, addr: s.address, lot: s.lotArea, price: s.value, listed: false, pay, ratio: s.value > 0 ? pay / s.value : null, use: s.use, floors: s.floors, owner: ownerName(g, p, s.bbl) ?? "" });
    }
    return { rows, vacant, pencil };
  }, [p]);
}

type SF = "listed" | "off" | "pencil" | "afford";

export function MarketSites() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const sel = useStore((s) => s.selectedBBL);
  const { rows, vacant, pencil } = useMemo(() => siteRows(game, parcels), [game, parcels]);
  const purse = useMemo(() => spendable(game, parcels).total, [game, parcels]);
  const [f, setF] = useState<SF[]>([]);
  const tests: Record<SF, (r: SiteRow) => boolean> = {
    listed: (r) => r.listed, off: (r) => !r.listed, pencil: (r) => (r.ratio ?? 0) >= 1, afford: (r) => r.price <= purse,
  };
  const shown = rows.filter((r) => f.every((k) => tests[k](r)));
  const n = (k: SF) => rows.filter(tests[k]).length;
  const cols: Col<SiteRow>[] = [
    { id: "addr", label: "Lot", get: (r) => r.addr, cell: (r) => strong(r.addr) },
    { id: "lot", label: "Lot sf", get: (r) => r.lot, fmt: "n" },
    { id: "price", label: "Price", get: (r) => r.price, fmt: "usd" },
    { id: "psf", label: "$/sf", get: (r) => (r.lot ? r.price / r.lot : null), fmt: "psf" },
    { id: "pay", label: "Builder pays", get: (r) => r.pay || null, fmt: "usd" },
    { id: "ratio", label: "Pays ×", get: (r) => r.ratio, fmt: "x", tone: (r) => ((r.ratio ?? 0) >= 1 ? "pos" : undefined) },
    { id: "use", label: "Scheme", get: (r) => r.use, cell: (r) => <span>{r.use ? `${r.use} · ${r.floors} fl` : "—"}</span> },
    { id: "where", label: "Market", get: (r) => (r.listed ? "listed" : "off"), tone: (r) => (r.listed ? "pos" : undefined) },
    { id: "owner", label: "Owner", get: (r) => r.owner, hidden: true },
  ];
  return (
    <div className="nx-place">
      <StatStrip>
        <Stat label="Vacant lots"><Figure value={vacant} fmt="n" /></Stat>
        <Stat label="Pencil"><Figure value={pencil} fmt="n" /></Stat>
        <Stat label="Listed"><Figure value={n("listed")} fmt="n" /></Stat>
        <Stat label="Off-market"><Figure value={n("off")} fmt="n" /></Stat>
        <Stat label="Purse"><Figure value={purse} fmt="usd" drill="cash" /></Stat>
      </StatStrip>
      <Chips<SF>
        chips={[
          { id: "pencil", label: "Pays ≥ 1×", n: n("pencil") },
          { id: "listed", label: "Listed", n: n("listed") },
          { id: "off", label: "Off-market", n: n("off") },
          { id: "afford", label: "Affordable", n: n("afford") },
        ]}
        on={f} set={setF} />
      <DataTable id="market-sites" cols={cols} rows={shown} rowKey={(r) => r.bbl} selected={sel} initialSort={{ col: "ratio", dir: -1 }} empty="No sites"
        onRow={(r) => useStore.getState().select(r.bbl)}
        actions={(r) => r.listed
          ? <button type="button" className="nx-btn nx-sm" title={usd(r.price)} onClick={() => { useStore.getState().select(r.bbl); dealAct(r.bbl, "offer", r.price); }}>Pay ask</button>
          : <button type="button" className="nx-btn nx-sm" disabled={!!game.approaches[r.bbl]} title={game.approaches[r.bbl] ? "Already asked" : undefined} onClick={() => { const st = useStore.getState(); st.select(r.bbl); st.approach(r.bbl); }}>Ask owner</button>} />
    </div>
  );
}

// ---------------------------------------------------------------- distressed
type DKind = "reo" | "docket" | "noticed" | "workout" | "watch" | "note";
interface DRow { key: string; bbl: string; addr: string; kind: DKind; who: string; debt: number | null; price: number | null; mark: number | null; off: number | null; ltv?: number | null; when: number | null; noteId?: string; perf?: string }
const DK: Record<DKind, string> = { reo: "Bank-owned", docket: "Docket", noticed: "Noticed", workout: "Workout", watch: "Watch", note: "Note" };

function distressRows(g: GameState, p: ParcelTable): DRow[] {
  return derive(g, "next.distress", () => {
    const out: DRow[] = [];
    const addr = (b: string) => resolveRec(p, g, b)?.address || b;
    for (const l of g.listings) {
      if (l.reason !== "receiver" || g.holdings[l.bbl]) continue;
      out.push({ key: "reo:" + l.bbl, bbl: l.bbl, addr: addr(l.bbl), kind: "reo", who: l.receiverFor ?? "", debt: null, price: l.ask, mark: l.mark ?? null, off: l.mark && l.mark > 0 ? 1 - l.ask / l.mark : null, when: l.expiresM });
    }
    if (g.auction && g.month < g.auction.m) {
      for (const lot of g.auction.lots) out.push({ key: "auc:" + lot.id, bbl: lot.bbl, addr: lot.address, kind: "docket", who: lot.holder, debt: lot.debt, price: lot.upset, mark: lot.est, off: lot.est > 0 ? 1 - lot.upset / lot.est : null, when: g.auction.m });
    }
    for (const f of g.bankFcls ?? []) out.push({ key: "fcl:" + f.bbl + f.noticedM, bbl: f.bbl, addr: addr(f.bbl), kind: "noticed", who: `${f.lender} · ${f.firm}`, debt: f.debt, price: null, mark: null, off: null, when: f.saleM });
    for (const l of Object.values(g.cityLoans ?? {})) {
      if (l.status === "current") continue;
      out.push({ key: "loan:" + l.bbl, bbl: l.bbl, addr: addr(l.bbl), kind: l.status, who: l.lender, debt: l.balance, price: null, mark: l.origValue, off: null, ltv: l.origValue > 0 ? l.balance / l.origValue : null, when: l.maturityM });
    }
    for (const n of g.noteOffers ?? []) {
      out.push({ key: "note:" + n.id, bbl: n.bbl, addr: n.address, kind: "note", who: `${n.lender} · ${n.obligor}`, debt: n.face, price: n.face * n.askPct, mark: null, off: 1 - n.askPct, when: n.expiresM, noteId: n.id, perf: n.perf === "performing" ? "perf" : "NPL" });
    }
    return out;
  }, [p]);
}

export function MarketDistressed() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const rows = useMemo(() => distressRows(game, parcels), [game, parcels]);
  const [f, setF] = useState<DKind[]>([]);
  const shown = f.length ? rows.filter((r) => f.includes(r.kind)) : rows;
  const n = (k: DKind) => rows.filter((r) => r.kind === k).length;
  const nextDocket = game.auction && game.month < game.auction.m ? game.auction.m : game.month + (((6 - (game.month % 12)) + 12) % 12 || 12);
  const cols: Col<DRow>[] = [
    { id: "addr", label: "Address", get: (r) => r.addr, cell: (r) => strong(r.addr) },
    { id: "kind", label: "Stage", get: (r) => Object.keys(DK).indexOf(r.kind), cell: (r) => <span className={"nx-stage nx-stage-" + r.kind}>{DK[r.kind]}{r.perf ? " · " + r.perf : ""}</span> },
    { id: "who", label: "Lender / firm", get: (r) => r.who },
    { id: "debt", label: "Debt", get: (r) => r.debt, fmt: "usd" },
    { id: "price", label: "Price", get: (r) => r.price, fmt: "usd" },
    { id: "mark", label: "Value", get: (r) => r.mark, fmt: "usd" },
    { id: "off", label: "Off mark", get: (r) => r.off, fmt: "pct", tone: (r) => ((r.off ?? 0) > 0.1 ? "pos" : undefined) },
    { id: "ltv", label: "LTV", get: (r) => r.ltv ?? null, fmt: "pct", tone: (r) => ((r.ltv ?? 0) > 0.8 ? "neg" : undefined) },
    { id: "when", label: "Date", get: (r) => r.when, cell: (r) => mo(r.when) },
  ];
  return (
    <div className="nx-place">
      <StatStrip>
        <Stat label="Bank-owned"><Figure value={n("reo")} fmt="n" /></Stat>
        <Stat label="Noticed"><Figure value={n("noticed")} fmt="n" /></Stat>
        <Stat label="Workout"><Figure value={n("workout")} fmt="n" /></Stat>
        <Stat label="Watch"><Figure value={n("watch")} fmt="n" /></Stat>
        <Stat label="Notes"><Figure value={n("note")} fmt="n" /></Stat>
        <Stat label="Docket"><Figure value={nextDocket} fmt="n" text={monthLabel(nextDocket)} /></Stat>
      </StatStrip>
      <Chips<DKind> chips={(Object.keys(DK) as DKind[]).map((k) => ({ id: k, label: DK[k], n: n(k) }))} on={f} set={setF} />
      <DataTable id="market-distress" cols={cols} rows={shown} rowKey={(r) => r.key} initialSort={{ col: "kind", dir: 1 }} empty="None"
        onRow={(r) => useStore.getState().select(r.bbl)}
        actions={(r) => {
          const st = useStore.getState();
          if (r.kind === "reo") return <button type="button" className="nx-btn nx-sm" title={usd(r.price ?? 0)} onClick={() => { st.select(r.bbl); dealAct(r.bbl, "offer", r.price!); }}>Pay ask</button>;
          if (r.kind === "docket") return <button type="button" className="nx-btn nx-sm nx-primary" onClick={() => st.setAuctionOpen(true)}>Bid</button>;
          if (r.kind === "note" && r.noteId) return <button type="button" className="nx-btn nx-sm" title={usd(r.price ?? 0)} onClick={() => st.takeNote(r.noteId!)}>Buy</button>;
          return null;
        }} />
    </div>
  );
}

// ---------------------------------------------------------------- books
interface BookRow { id: string; seller: string; n: number; reo: boolean; ask: number; gross: number; disc: number; occ: number | null; noi: number; yAsk: number | null; yGross: number | null; sf: number; psf: number | null; listedM: number; cuts: number; talks: number | null }

function bookRows(g: GameState, p: ParcelTable): BookRow[] {
  return derive(g, "next.books", () => (g.portfolios ?? []).filter((b) => !b.player).map((b) => {
    const st = streetBookStats(g, p, b);
    const seller = b.sellerLender ?? (b.sellerId ? (g.rivals?.find((r) => r.id === b.sellerId)?.name ?? "A fund") : "A seller");
    return {
      id: b.id, seller: b.reoBorrower ? `${seller} · ${b.reoBorrower}` : seller, n: b.bbls.length, reo: !!b.reo,
      ask: b.ask, gross: b.gross, disc: b.gross > 0 ? 1 - b.ask / b.gross : 0, occ: st.occ, noi: st.noi,
      yAsk: st.yieldOnAsk, yGross: st.yieldOnGross, sf: st.totSf, psf: st.askPsf, listedM: b.listedM, cuts: b.cuts,
      talks: b.talks?.theirPrice ?? null,
    };
  }), [p]);
}

export function MarketBooks() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const rows = useMemo(() => bookRows(game, parcels), [game, parcels]);
  const purse = useMemo(() => spendable(game, parcels).total, [game, parcels]);
  const [open, setOpen] = useState<string | null>(null);
  const book = open ? (game.portfolios ?? []).find((b) => b.id === open) : undefined;
  const assets = useMemo(() => (book ? streetBookStats(game, parcels, book).assets : []), [book, game, parcels]);
  const cols: Col<BookRow>[] = [
    { id: "seller", label: "Seller", get: (r) => r.seller, cell: (r) => <span className="nx-strong-cell">{r.seller}{r.reo ? <span className="nx-chip nx-chip-red">REO</span> : null}</span> },
    { id: "n", label: "Deeds", get: (r) => r.n, fmt: "n" },
    { id: "ask", label: "Ask", get: (r) => r.ask, fmt: "usd" },
    { id: "gross", label: "Parts", get: (r) => r.gross, fmt: "usd" },
    { id: "disc", label: "Discount", get: (r) => r.disc, fmt: "pct", tone: (r) => (r.disc > 0.08 ? "pos" : undefined) },
    { id: "occ", label: "Occ", get: (r) => r.occ, fmt: "pct", tone: (r) => (r.occ !== null && r.occ < 0.7 ? "neg" : undefined) },
    { id: "noi", label: "NOI", get: (r) => r.noi, fmt: "usd", tone: (r) => (r.noi <= 0 ? "neg" : undefined) },
    { id: "yask", label: "Going-in", get: (r) => r.yAsk, fmt: "pct", tone: (r) => ((r.yAsk ?? 0) >= 0.08 ? "pos" : undefined) },
    { id: "ygross", label: "Cap on parts", get: (r) => r.yGross, fmt: "pct", hidden: true },
    { id: "sf", label: "sf", get: (r) => r.sf, fmt: "n" },
    { id: "psf", label: "$/sf", get: (r) => r.psf, fmt: "psf", hidden: true },
    { id: "cuts", label: "Cuts", get: (r) => r.cuts, fmt: "n", tone: (r) => (r.cuts > 0 ? "neg" : undefined) },
    { id: "listed", label: "Listed", get: (r) => r.listedM, cell: (r) => mo(r.listedM) },
    { id: "talks", label: "Their price", get: (r) => r.talks, fmt: "usd" },
  ];
  type A = (typeof assets)[number];
  const acols: Col<A>[] = [
    { id: "addr", label: "Property", get: (a) => a.address, cell: (a) => strong(a.address) },
    { id: "cls", label: "Use", get: (a) => a.cls },
    { id: "sf", label: "sf", get: (a) => a.sf, fmt: "n" },
    { id: "occ", label: "Occ", get: (a) => (a.land ? null : a.occ), fmt: "pct" },
    { id: "noi", label: "NOI", get: (a) => a.noi, fmt: "usd", tone: (a) => (a.noi < 0 ? "neg" : undefined) },
    { id: "val", label: "Value", get: (a) => a.val, fmt: "usd" },
    { id: "share", label: "Ask share", get: (a) => a.askShare, fmt: "usd" },
    { id: "roll", label: "Roll", get: (a) => (a.land ? "" : a.disclosed ? "disclosed" : "est.") },
  ];
  return (
    <div className="nx-place">
      <StatStrip>
        <Stat label="Books"><Figure value={rows.length} fmt="n" /></Stat>
        <Stat label="Deeds"><Figure value={rows.reduce((a, r) => a + r.n, 0)} fmt="n" /></Stat>
        <Stat label="Asks"><Figure value={rows.reduce((a, r) => a + r.ask, 0)} fmt="usd" /></Stat>
        <Stat label="Purse"><Figure value={purse} fmt="usd" drill="cash" /></Stat>
      </StatStrip>
      <DataTable id="market-books" cols={cols} rows={rows} rowKey={(r) => r.id} selected={open} initialSort={{ col: "yask", dir: -1 }} empty="No books"
        onRow={(r) => setOpen(open === r.id ? null : r.id)}
        actions={(r) => {
          const st = useStore.getState();
          const need = r.ask * 1.02;
          return (
            <span className="nx-row-verbs">
              {r.talks !== null && <button type="button" className="nx-btn nx-sm" disabled={purse < r.talks * 1.02} title={purse < r.talks * 1.02 ? `Needs ${usd(r.talks * 1.02 - purse)} more` : undefined} onClick={() => st.acceptStreetBook(r.id)}>Take {usd(r.talks)}</button>}
              <button type="button" className="nx-btn nx-sm" onClick={() => st.offerStreetBook(r.id, Math.round(r.ask * 0.94))}>Offer {usd(Math.round(r.ask * 0.94))}</button>
              <button type="button" className="nx-btn nx-sm nx-primary" disabled={purse < need} title={purse < need ? `Needs ${usd(need - purse)} more` : undefined} onClick={() => st.buyStreetBook(r.id)}>Pay ask</button>
            </span>
          );
        }} />
      {book && (
        <div className="nx-box">
          <div className="nx-box-head">Schedule · {book.bbls.length}</div>
          <DataTable id="market-book-assets" cols={acols} rows={assets} rowKey={(a) => a.bbl} initialSort={{ col: "val", dir: -1 }} onRow={(a) => useStore.getState().select(a.bbl)} />
        </div>
      )}
    </div>
  );
}
