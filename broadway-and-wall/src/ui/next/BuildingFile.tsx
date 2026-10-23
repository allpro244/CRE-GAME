/**
 * THE BUILDING FILE (BUILD_SPEC 4.1). Opens on any selected deed. Overview is
 * new: figures that drill. Rent roll, Money, Build and Deal host the classic
 * desks until step 5 replaces them. Buying and selling are the footer.
 */
import { LandDesk } from "@/ui/panels/PropertyDesks";
import { useEffect, useState } from "react";
import { useStore, type PropertyTab } from "@/state/store";
import type { GameState, Holding } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import { monthLabel } from "@/engine/types";
import {
  initialCondition, inPlace, landRead, marketAppraisal, marketRentPsfYr, ownedHoldingNoiYrFromRec, resolveRec,
} from "@/engine/value";
import { replacementCost } from "@/engine/dev";
import { occupancyRead, walt } from "@/engine/leasing";
import { dscr as dscrOf, ltv as ltvOf, loanLender } from "@/engine/debt";
import { demandNow } from "@/engine/demand";
import { describePropertyEvent, propertyTimeline } from "@/engine/history";
import { entitleQuote, platQuote } from "@/engine/landdev";
import { tractLotQuote } from "@/engine/homes";
import { tractYield, plannedLots } from "@/engine/platdesign";
import { HomesCard, ParcelPanel } from "@/ui/panels/ParcelDesk";
import { BuildDesk, breakGround, schemeName } from "./BuildDesk";
import { deskScheme } from "./scheme";
import PlatDesk, { platVerb } from "./PlatDesk";
import { platScheme, platCommit, usePlatDrafts } from "./platScheme";
import { ownerName } from "@/ui/derive";
import { usd, sf } from "@/ui/format";
import { ActionFooter, Drawer, type Verb } from "./Drawer";
import { Figure, Spark, fmtFig } from "./Figure";
import { buyPreview, buyDesks } from "./buy";
import { useNext } from "./nextStore";
import { MoneyTab, RefiTable, RentRollTab } from "./FileTabs";
import { SplitTab } from "./SplitTab";

type FileTab = "overview" | "leasing" | "money" | "build" | "split" | "deal" | "history";
const FROM_PROP: Partial<Record<PropertyTab, FileTab>> = {
  summary: "overview", leasing: "leasing", ops: "leasing", money: "money", build: "build", deal: "deal", history: "history",
};

export function BuildingFile() {
  const bbl = useStore((s) => (s.selectedBBL ? s.game?.merged?.[s.selectedBBL] ?? s.selectedBBL : null));
  if (!bbl) return null;
  return <FileFor key={bbl} bbl={bbl} />;
}

function FileFor({ bbl }: { bbl: string }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const asked = useStore((s) => s.propertyTab);
  const [tab, setTab] = useState<FileTab>("overview");
  useEffect(() => {
    if (!asked) return;
    setTab(FROM_PROP[asked] ?? "overview");
    useStore.setState({ propertyTab: null });
  }, [asked]);
  const rec = resolveRec(parcels, game, bbl);
  const close = () => {
    const st = useStore.getState();
    if (st.page === "property") st.setPage("none");
    st.select(null);
  };
  if (!rec) return null;
  const h = game.holdings[bbl];
  const built = rec.class !== "land" && rec.bldgArea > 0 && !h?.groundLeased;
  const listing = game.listings.find((l) => l.bbl === bbl);
  const talks = game.talks?.[bbl];
  const timeline = propertyTimeline(game, bbl);
  const tabs: { id: FileTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    ...(h && built ? [{ id: "leasing" as const, label: "Rent roll" }] : []),
    ...(h ? [{ id: "money" as const, label: "Money" }] : []),
    ...(h && !h.groundLeased ? [{ id: "build" as const, label: "Build" }] : []),
    // any deed you own, downtown or not, can be cut into lots (engine/lotsplit.ts); a farm tract is platted instead
    ...(h && !parcels[bbl]?.tract ? [{ id: "split" as const, label: "Split" }] : []),
    { id: "deal", label: h ? "Sell" : "Deal" },
    ...(timeline.length ? [{ id: "history" as const, label: "History" }] : []),
  ];
  const active = tabs.some((t) => t.id === tab) ? tab : "overview";
  const cond = h?.condition ?? initialCondition(rec);
  const owner = h ? "You" : ownerName(game, parcels, bbl) ?? "City";
  const meta = [
    rec.class, built ? `${rec.floors} fl` : null, built ? sf(rec.bldgArea) : `lot ${sf(rec.lotArea)}`,
    built ? String(rec.yearBuilt) : null, built ? cond : null, owner,
  ].filter(Boolean).join(" · ");
  const chips: { label: string; tone?: "gold" | "teal" | "red" }[] = [];
  if (h) chips.push({ label: "Yours", tone: "gold" });
  if (listing && !h) chips.push({ label: "For sale", tone: "teal" });
  if (talks?.agreed) chips.push({ label: "Under contract", tone: "teal" });
  if (h?.sale) chips.push({ label: "Listed", tone: "teal" });
  if (game.workouts?.[bbl]) chips.push({ label: "Workout", tone: "red" });
  return (
    <Drawer
      width={active === "leasing" || active === "money" || active === "build" || active === "split" || active === "deal" ? "wide" : "std"}
      crumbs={h ? ["Holdings"] : listing ? ["Market"] : undefined}
      title={rec.address || bbl}
      meta={meta}
      chips={chips}
      tabs={tabs}
      tab={active}
      onTab={(t) => setTab(t as FileTab)}
      onClose={close}
      footer={<FileFooter game={game} parcels={parcels} bbl={bbl} h={h} tab={active} setTab={setTab} />}
    >
      {active === "overview" && <Overview game={game} parcels={parcels} bbl={bbl} h={h} />}
      {/* the land desk — FAR to request, the ground lease, assembly — on the Overview (owner) */}
      {active === "overview" && h && <div className="nx-hosted"><LandDesk bbl={bbl} /></div>}
      {active === "leasing" && h && <RentRollTab game={game} parcels={parcels} bbl={bbl} h={h} />}
      {active === "money" && h && <MoneyTab game={game} parcels={parcels} bbl={bbl} h={h} />}
      {active === "build" && <BuildTab game={game} parcels={parcels} bbl={bbl} />}
      {active === "split" && <SplitTab game={game} parcels={parcels} bbl={bbl} />}
      {/* A PLAT'S LOT: the builders' bids, their offers, and listing the plat to them. The classic
          card lives on the summary tab, which this file does not host, so the new UI had no way to
          list lots at all (tools/playtest.mjs, 2026-10-22). */}
      {active === "deal" && <div className="nx-hosted">{rec.homeLot && <HomesCard bbl={bbl} />}<ParcelPanel embedded tab="deal" /></div>}
      {active === "history" && (
        <table className="nx-table">
          <thead><tr><th>When</th><th>Event</th><th>Detail</th></tr></thead>
          <tbody>
            {timeline.map((e, i) => {
              const r = describePropertyEvent(e);
              return <tr key={i}><td className="mono">{r.when}</td><td>{r.title}</td><td className="nx-dim">{r.detail}</td></tr>;
            })}
          </tbody>
        </table>
      )}
    </Drawer>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="nx-stat"><div className="nx-stat-label">{label}</div><div className="nx-stat-value">{children}</div></div>;
}

function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <table className="nx-kv">
      <tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody>
    </table>
  );
}

function Overview({ game, parcels, bbl, h }: { game: GameState; parcels: ParcelTable; bbl: string; h?: Holding }) {
  const rec = resolveRec(parcels, game, bbl)!;
  const built = rec.class !== "land" && rec.bldgArea > 0 && !h?.groundLeased;
  const cond = h?.condition ?? initialCondition(rec);
  const value = marketAppraisal(game, rec, bbl, cond);
  const listing = game.listings.find((l) => l.bbl === bbl);
  const ask = listing?.ask ?? null;
  const ip = inPlace(rec, game, bbl, ask ?? value);
  const hist = game.econ.history ?? [];
  const cls = rec.class as keyof NonNullable<(typeof hist)[number]["rent"]>;
  const rentSeries = hist.slice(-24).map((x) => x.rent?.[cls] ?? NaN);
  const mkt = built ? marketRentPsfYr(rec, game.econ, cond) : 0;
  const lr = landRead(rec, game.econ);
  const args = { bbl, price: ask ?? undefined };
  const strip = h ? (() => {
    const debt = (h.loan?.balance ?? 0) + (h.mezz?.balance ?? 0);
    const ds = ((h.loan?.monthlyPmt ?? 0) + (h.mezz?.monthlyPmt ?? 0)) * 12;
    const d = dscrOf(rec, game, h);
    const occ = built ? occupancyRead(rec, h).lettableOcc : null;
    // The deed's NOI as the lender tests it and Holdings prints it (cash, after
    // free rent); the contract NOI is a row in its drill (R8).
    const noi = ownedHoldingNoiYrFromRec(game, rec, h);
    return (
      <>
        <Stat label="Value"><Figure value={value} fmt="usd" drill="value" args={args} /></Stat>
        <Stat label="NOI"><Figure value={noi} fmt="usd" drill="noi" args={args} tone={noi < 0 ? "neg" : undefined} /></Stat>
        <Stat label="Occ"><Figure value={occ} fmt="pct" drill="rent" args={args} /></Stat>
        <Stat label="Debt"><Figure value={debt} fmt="usd" drill="dscr" args={args} /></Stat>
        <Stat label="DSCR"><Figure value={d} fmt="x" drill="dscr" args={args} tone={d !== null && h.loan && d < h.loan.minDSCR ? "neg" : undefined} /></Stat>
        <Stat label="CF / mo"><Figure value={(noi - ds) / 12} fmt="usd" drill="noi" args={args} tone={noi - ds < 0 ? "neg" : undefined} /></Stat>
      </>
    );
  })() : (
    <>
      <Stat label="Ask"><Figure value={ask} fmt="usd" /></Stat>
      <Stat label="Going-in"><Figure value={ask ? ip.noi / ask : null} fmt="pct" drill="cap" args={args} /></Stat>
      <Stat label="NOI"><Figure value={built ? ip.noi : null} fmt="usd" drill="noi" args={args} /></Stat>
      <Stat label="Value"><Figure value={value} fmt="usd" drill="value" args={args} /></Stat>
      {ask !== null && <Stat label="vs ask"><Figure value={value / ask - 1} fmt="pct" drill="value" args={args} tone={value >= ask ? "pos" : "neg"} /></Stat>}
    </>
  );
  const leasedSf = h ? h.tenants.reduce((a, t) => a + t.sf, 0) : 0;
  const avgRent = h && leasedSf > 0 ? h.tenants.reduce((a, t) => a + t.sf * t.rentPsf, 0) / leasedSf : null;
  const roll2 = h && leasedSf > 0 ? h.tenants.filter((t) => t.endM - game.month <= 24).reduce((a, t) => a + t.sf, 0) / leasedSf : null;
  const rc = built ? replacementCost(rec, game.econ) : 0;
  return (
    <div className="nx-overview">
      <div className="nx-strip">{strip}</div>
      <div className="nx-cols">
        {parcels[bbl]?.tract && <TractBox game={game} parcels={parcels} bbl={bbl} />}
        {built && (
          <div className="nx-box">
            <div className="nx-box-head">Rent</div>
            <KV rows={[
              ...(h ? [["In place", <Figure key="r" value={avgRent} fmt="psf" drill="rent" args={args} />] as [string, React.ReactNode]] : []),
              ["Market", <span key="m" className="nx-with-spark"><Figure value={mkt} fmt="psf" drill="rent" args={args} /><Spark pts={rentSeries} /></span>],
              ...(h ? [] : [["Leased", <Figure key="l" value={ip.occ} fmt="pct" drill="rent" args={args} />] as [string, React.ReactNode]]),
              ...(h ? [
                ["Roll 2y", <Figure key="r2" value={roll2} fmt="pct" drill="rent" args={args} />] as [string, React.ReactNode],
                ["WALT", <span key="w" className="nx-fig">{h.tenants.length ? walt(h, game.month).toFixed(1) + " y" : "—"}</span>] as [string, React.ReactNode],
              ] : []),
            ]} />
          </div>
        )}
        <div className="nx-box">
          <div className="nx-box-head">Asset</div>
          <KV rows={[
            ...(built ? [["Condition", <span key="c" className="nx-fig">{cond}</span>] as [string, React.ReactNode]] : []),
            ...(rc ? [["Value ÷ cost", <Figure key="vc" value={value / rc} fmt="x" drill="value" args={args} />] as [string, React.ReactNode]] : []),
            ["Demand", <span key="d" className="nx-fig">{Math.round(demandNow(game, rec))}</span>],
            ["Land value", <Figure key="lv" value={lr.psf * rec.lotArea} fmt="usd" drill="land" args={args} />],
            ["Land $/sf", <Figure key="lp" value={lr.psf} fmt="psf" drill="land" args={args} />],
            ...(listing ? [["Listed", <span key="li" className="nx-fig">{monthLabel(listing.listedM)}</span>] as [string, React.ReactNode]] : []),
          ]} />
        </div>
        {h?.loan && (
          <div className="nx-box">
            <div className="nx-box-head">Loan</div>
            <KV rows={[
              ["Lender", <span key="ln" className="nx-fig">{loanLender(h.loan)}</span>],
              ["Balance", <Figure key="b" value={h.loan.balance} fmt="usd" drill="debt" />],
              ["Coupon", <Figure key="c" value={h.loan.ratePct} fmt="pctv" drill="rate" args={args} />],
              ["Matures", <span key="m" className="nx-fig">{monthLabel(h.loan.maturityM)}</span>],
              ["LTV", <Figure key="ltv" value={ltvOf(rec, game, h)} fmt="pct" drill="value" args={args} />],
              ["Min DSCR", <Figure key="md" value={h.loan.minDSCR} fmt="x" drill="dscr" args={args} />],
            ]} />
          </div>
        )}
      </div>
      {ip.h && ip.h.tenants.length > 0 && (
        <table className="nx-table">
          <thead><tr><th>Tenant</th><th className="num">sf</th><th className="num">$/sf</th><th className="num">vs mkt</th><th className="num">Ends</th></tr></thead>
          <tbody>
            {ip.h.tenants.slice().sort((a, b) => b.sf - a.sf).slice(0, 10).map((t, i) => (
              <tr key={t.name + i}>
                <td>{t.name}</td>
                <td className="num mono">{Math.round(t.sf).toLocaleString()}</td>
                <td className="num mono">{t.rentPsf.toFixed(2)}</td>
                <td className={"num mono" + (mkt > 0 && t.rentPsf < mkt ? " nx-neg" : " nx-pos")}>{mkt > 0 ? fmtFig(t.rentPsf / mkt - 1, "pct") : "—"}</td>
                <td className={"num mono" + (t.endM - game.month <= 12 ? " nx-neg" : "")}>{monthLabel(t.endM)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * THE TRACT, IN NUMBERS (region). Where it stands — farm, at the board,
 * entitled, streets going in — and what each next step costs and returns, from
 * the engine's own quotes (landdev.ts entitleQuote / platQuote, homes.ts
 * tractLotQuote) on the plat the desk draws by default (platdesign.ts tractYield), as the
 * classic land card reads them.
 */
function TractBox({ game, parcels, bbl }: { game: GameState; parcels: ParcelTable; bbl: string }) {
  const rec = parcels[bbl]!;
  const tr = rec.tract!;
  const app = game.entitlementApps?.[bbl], rz = game.rezoned?.[bbl], plat = game.plats?.[bbl];
  const { n: nLots, lotSf } = plannedLots(game, parcels, bbl);
  const lots = plat ? plat.lots : tractYield(rec, lotSf).lots;
  const eq = !app && !rz && game.holdings[bbl] ? entitleQuote(game, parcels, bbl, lotSf, nLots) : null;
  const pq = rz && !plat ? platQuote(game, lots.map(({ a, f, d }) => ({ a, f, d }))) : null;
  const t = !plat && nLots >= 4 ? tractLotQuote(game, parcels, bbl, lotSf, nLots) : null;
  const stage = plat ? (plat.done ? "Lots" : "Streets") : app ? "Board" : rz ? "Entitled" : "Farm";
  const rows: [string, React.ReactNode][] = [
    ["Stage", <span key="s" className={"nx-stage nx-stage-" + stage.toLowerCase()}>{stage}</span>],
    ["Acres", <span key="a" className="nx-fig">{(rec.lotArea / 43_560).toFixed(1)}</span>],
    ["Edge", <span key="e" className="nx-fig">{(tr.edgeM / 1000).toFixed(1)} km</span>],
    ["Lots", <span key="l" className="nx-fig">{nLots >= 4 ? `${nLots} × ${lotSf.toLocaleString()} sf` : "none fit"}</span>],
  ];
  if (eq) rows.push(["Rezone cost", <span key="rc" className="nx-fig">{usd(eq.cost)}</span>], ["Board", <span key="bm" className="nx-fig">{eq.months} mo · {Math.round(eq.odds * 100)}%</span>]);
  if (app) rows.push(["Board", <span key="bd" className="nx-fig">{monthLabel(app.decideM)} · {Math.round(app.odds * 100)}%</span>]);
  if (pq) rows.push(["Streets", <span key="pc" className="nx-fig">{usd(pq.cost)} · {usd(pq.perLot)}/lot</span>], ["Built in", <span key="pm" className="nx-fig">{pq.months} mo</span>]);
  if (plat && !plat.done) rows.push(["Streets done", <span key="pd" className="nx-fig">{monthLabel(plat.doneM)}</span>]);
  if (t) rows.push(["House", <span key="h" className="nx-fig">{usd(t.quote.price)}</span>], ["Lot residual", <span key="r" className="nx-fig">{usd(t.quote.residual)}</span>], ["Sell-out", <span key="so" className="nx-fig">{t.pace.toFixed(1)}/mo · ×{t.disc.toFixed(2)}</span>], ["Lot value", <span key="lv" className="nx-fig">{usd(t.lotValue)}</span>]);
  return (
    <div className="nx-box">
      <div className="nx-box-head">Tract</div>
      <KV rows={rows} />
    </div>
  );
}

function BuildTab({ game, parcels, bbl }: { game: GameState; parcels: ParcelTable; bbl: string }) {
  const rec = resolveRec(parcels, game, bbl);
  const h = game.holdings[bbl];
  // a vacant lot you own, not yet building: the simple Build desk (its commit is the footer's)
  if (h && !game.developments[bbl] && rec?.class === "land" && !rec.tract && !rec.ag && rec.zoneDist !== "AG" && !h.groundLeased && !game.groundLeases?.[bbl]) {
    return <div className="nx-hosted"><BuildDesk bbl={bbl} /></div>;
  }
  // a farm tract: the land desk (its commit is the footer's too)
  if (h && rec?.tract && rec.ag) return <div className="nx-hosted"><PlatDesk bbl={bbl} /></div>;
  return (
    <div className="nx-hosted">
      <ParcelPanel embedded tab="build" />
    </div>
  );
}

function FileFooter({ game, parcels, bbl, h, tab, setTab }: {
  game: GameState; parcels: ParcelTable; bbl: string; h?: Holding; tab: FileTab; setTab: (t: FileTab) => void;
}) {
  const st = useStore.getState();
  usePlatDrafts();
  const preset = useNext((s) => s.buyPreset);
  const listing = game.listings.find((l) => l.bbl === bbl);
  const talks = game.talks?.[bbl];
  const rec = resolveRec(parcels, game, bbl);
  const [amt, setAmt] = useState<number | null>(null);
  const [refiOpen, setRefiOpen] = useState(false);
  if (!rec) return null;
  const value = marketAppraisal(game, rec, bbl, h?.condition ?? initialCondition(rec));
  const amount = (initial: number) => (
    <input className="nx-amt mono" type="number" step={10000} value={n(initial)}
      onChange={(e) => setAmt(Number(e.target.value))} aria-label="Amount" />
  );
  const n = (initial: number) => amt ?? Math.round(initial / 1000) * 1000;

  // ---- you own it
  if (h) {
    const verbs: Verb[] = [];
    // THE QUOTES IN THE FOOTER: the desks that will write today, cheapest first, one click to take.
    if (refiOpen && h.loan) {
      return (
        <div className="nx-confirm">
          <RefiTable game={game} parcels={parcels} bbl={bbl} max={3} />
          <ActionFooter verbs={[{ label: "All quotes", run: () => { setRefiOpen(false); setTab("money"); } }, { label: "Close", run: () => setRefiOpen(false) }]} />
        </div>
      );
    }
    if (h.loan) verbs.push({ label: "Refinance", run: () => setRefiOpen(true) });
    // A FARM TRACT (region): rezone it, then build the streets (landdev.ts via the store)
    const tr = parcels[bbl]?.tract;
    if (tr) {
      // THE DESK'S PLAT, filed or built as the desk shows it (platScheme)
      const ps = platScheme(game, parcels, bbl);
      const verb = platVerb(ps);
      const step: Verb[] = verb ? [{ label: verb, primary: true, disabled: ps.why ?? undefined, run: () => platCommit(ps, bbl, st) }] : [];
      const out: Verb[] = [{ label: "List", run: () => { st.listSale(bbl, n(value), "quiet"); setAmt(null); } }, ...verbs, ...step];
      return <ActionFooter input={amount(value)} verbs={out} inputAt={0} />;
    }
    if (rec.class === "land" || !rec.bldgArea) {
      if (game.developments[bbl]) return <ActionFooter verbs={[{ label: "Job file", run: () => setTab("build") }]} />;
      // the sweep is dozens of pro formas: run it only once the Build tab is asked for
      if (tab !== "build") return <ActionFooter verbs={[...verbs, { label: "Plan", primary: true, run: () => setTab("build") }]} />;
      // ONE SCHEME: the footer breaks ground on exactly what the desk shows (deskScheme)
      const d = deskScheme(game, parcels, bbl);
      return (
        <ActionFooter
          left={d.plan ? <span className="mono nx-dim">{schemeName(d)} · {d.plan.hurdleRatio.toFixed(2)}×</span> : undefined}
          verbs={[{ label: "Break ground", primary: true, disabled: d.why ?? undefined, run: () => breakGround(d, bbl) }]}
        />
      );
    }
    if (h.sale) {
      const bids = (h.sale.bids ?? []).filter((b) => !b.dropped);
      verbs.push({ label: "Delist", run: () => st.delistSale(bbl) });
      verbs.push({ label: "Reprice", primary: !bids.length, run: () => { st.reprice(bbl, n(h.sale!.ask)); setAmt(null); } });
      if (bids.length) verbs.push({ label: `Take ${usd(bids[0].price)}`, primary: true, run: () => st.takeBid(bbl, 0) });
      return <ActionFooter input={amount(h.sale.ask)} inputAt={verbs.length - (bids.length ? 2 : 1)} verbs={verbs} />;
    }
    verbs.push({ label: "Renovate", run: () => st.renovate(bbl) });
    verbs.push({ label: "Build", run: () => setTab("build") });
    verbs.push({ label: "List", primary: true, run: () => { st.listSale(bbl, n(value), "quiet"); setAmt(null); } });
    return <ActionFooter input={amount(value)} verbs={verbs} />;
  }

  // ---- under contract: fund it with the preset
  if (talks?.agreed) {
    const price = talks.agreedPrice ?? talks.theirPrice;
    const q = buyPreview(game, parcels, bbl, price, preset);
    return (
      <div className="nx-confirm">
        <div className="nx-strip nx-strip-sm">
          <Stat label="Price"><Figure value={price} fmt="usd" /></Stat>
          <Stat label="Equity"><Figure value={q.equity} fmt="usd" drill="cash" /></Stat>
          <Stat label="Loan"><Figure value={q.principal} fmt="usd" /></Stat>
          <Stat label="Debt svc"><Figure value={q.ds} fmt="usd" /></Stat>
          <Stat label="CoC"><Figure value={q.coc} fmt="pct" drill="noi" args={{ bbl, price }} tone={q.coc !== null && q.coc < 0 ? "neg" : undefined} /></Stat>
          <Stat label="DSCR"><Figure value={q.dscr} fmt="x" drill="noi" args={{ bbl, price }} /></Stat>
        </div>
        <ActionFooter
          steps={["Price", "Confirm"]} step={1}
          left={<><PresetPicker isLand={rec.class === "land"} /><span className="nx-dim mono">{q.label}{q.principal ? ` · ${(q.ratePct).toFixed(2)}%` : ""}</span></>}
          verbs={[
            { label: "Custom", run: () => setTab("deal") },
            { label: "Walk", run: () => st.walkAway(bbl) },
            { label: "Confirm", primary: true, run: () => st.closeDeal(bbl, q.product, q.lev || 1) },
          ]}
        />
      </div>
    );
  }

  // ---- in talks: their number
  if (talks) {
    return (
      <ActionFooter
        steps={["Price", "Confirm"]} step={0}
        input={talks.final ? undefined : amount(talks.yourPrice)}
        inputAt={0}
        verbs={[
          ...(talks.final ? [] : [{ label: `Offer ${usd(n(talks.yourPrice))}`, run: () => { st.offer(bbl, n(talks.yourPrice)); setAmt(null); } }]),
          { label: "Walk", run: () => st.walkAway(bbl) },
          { label: `Take ${usd(talks.theirPrice)}`, primary: true, run: () => st.acceptCounter(bbl) },
        ]}
      />
    );
  }

  // ---- listed: pay the ask or offer under it
  if (listing) {
    return (
      <ActionFooter
        steps={["Price", "Confirm"]} step={0}
        input={amount(listing.ask * 0.95)}
        inputAt={0}
        verbs={[
          { label: `Offer ${usd(n(listing.ask * 0.95))}`, run: () => { st.offer(bbl, n(listing.ask * 0.95)); setAmt(null); } },
          { label: `Pay ask ${usd(listing.ask)}`, primary: true, key: "B", run: () => st.offer(bbl, listing.ask, false) },
        ]}
      />
    );
  }

  // ---- not for sale
  const ap = game.approaches[bbl];
  if (ap?.ask && !ap.refused) {
    return <ActionFooter verbs={[{ label: `Ask ${usd(ap.ask)}`, primary: true, run: () => setTab("deal") }]} />;
  }
  return (
    <ActionFooter
      input={amount(value)}
      inputAt={0}
      verbs={[
        { label: `Bid ${usd(n(value))}`, run: () => { st.bidBlind(bbl, n(value)); setAmt(null); } },
        { label: "Approach", primary: true, disabled: ap && (ap.refused || (ap.coldUntilM ?? 0) > game.month) ? "Owner said no" : undefined, run: () => st.approach(bbl) },
      ]}
    />
  );
}

function PresetPicker({ isLand }: { isLand: boolean }) {
  const preset = useNext((s) => s.buyPreset);
  const set = useNext((s) => s.setBuyPreset);
  const desks = buyDesks(isLand);
  return (
    <span className="nx-preset">
      <select className="nx-select" value={preset.product} onChange={(e) => set({ ...preset, product: e.target.value })} aria-label="Lender">
        <option value="cheapest">Cheapest</option>
        <option value="cash">All cash</option>
        {desks.map((d) => <option key={d.id} value={d.id}>{d.lender}</option>)}
      </select>
      <select className="nx-select" value={String(preset.lev)} onChange={(e) => set({ ...preset, lev: Number(e.target.value) })} aria-label="Leverage">
        {[1, 0.85, 0.7, 0.5].map((l) => <option key={l} value={l}>{fmtFig(l, "pct")} of max</option>)}
      </select>
    </span>
  );
}
