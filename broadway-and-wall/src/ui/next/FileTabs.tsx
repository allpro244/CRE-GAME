/**
 * THE BUILDING FILE'S RENT ROLL AND MONEY TABS, AS TABLES (PLAN §5 step 5).
 *
 * Every lease and every loan on one screen, sortable, and the letters and
 * refinance quotes that change them answered on the row. What these tables do
 * not carry (leasing policy, rate caps, mezz, stakes, ground leases) is one
 * click away under "Desk", the classic desk hosted unchanged.
 */
import { useMemo, useState } from "react";
import { useStore } from "@/state/store";
import type { GameState, Holding, Tenant } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import { monthLabel, CREDIT_LABEL } from "@/engine/types";
import { initialCondition, marketAppraisal, marketRentPsfYr, operatingStatement, ownedHoldingNoiYr, resolveRec } from "@/engine/value";
import { occupancyRead, walt, loiSigningCost } from "@/engine/leasing";
import { dscr, ltv, loanLender, payOffDue, refiQuotes, type RefiQuote } from "@/engine/debt";
import { loiMarketPsf } from "@/ui/panels/LoiNegotiate";
import { ParcelPanel } from "@/ui/panels/ParcelDesk";
import { derive } from "@/ui/derive";
import { usd } from "@/ui/format";
import { DataTable, Stat, StatStrip, type Col } from "./DataTable";
import { Figure, fmtFig } from "./Figure";
import { VerbButton } from "./Drawer";
import { CapitalDesk } from "./CapitalDesk";

/** "Desk": the classic tab, hosted, for everything the table does not carry. */
function Desk({ tabs, force }: { tabs: ("leasing" | "ops" | "money")[]; force?: boolean }) {
  const [open0, setOpen] = useState(false);
  const open = open0 || !!force;
  return (
    <div className="nx-desk">
      <button type="button" className="nx-link" onClick={() => setOpen(!open)}>{open ? "Hide desk ▴" : "Desk ▾"}</button>
      {open && <div className="nx-hosted">{tabs.map((t) => <ParcelPanel key={t} embedded tab={t} />)}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- rent roll
interface LeaseRow { i: number; t: Tenant; mkt: number }

export function RentRollTab({ game, parcels, bbl, h }: { game: GameState; parcels: ParcelTable; bbl: string; h: Holding }) {
  const rec = resolveRec(parcels, game, bbl)!;
  const cond = h.condition ?? initialCondition(rec);
  const mkt = marketRentPsfYr(rec, game.econ, cond);
  const os = operatingStatement(rec, game.econ, h, game.month);
  const occ = occupancyRead(rec, h);
  const leased = h.tenants.reduce((a, t) => a + t.sf, 0);
  const avg = leased > 0 ? h.tenants.reduce((a, t) => a + t.sf * t.rentPsf, 0) / leased : null;
  const roll12 = h.tenants.filter((t) => t.endM - game.month <= 12).reduce((a, t) => a + t.sf, 0);
  const rows: LeaseRow[] = h.tenants.map((t, i) => ({ i, t, mkt }));
  const lois = game.lois.filter((l) => l.bbl === bbl);
  // a counter is written on the classic letter desk: open it on the letter
  const focus = useStore((s) => s.loiFocusId);
  const countering = focus !== null && lois.some((l) => l.id === focus);
  const args = { bbl };
  const cols: Col<LeaseRow>[] = [
    { id: "name", label: "Tenant", get: (r) => r.t.name },
    { id: "use", label: "Use", get: (r) => r.t.use ?? rec.class },
    { id: "sector", label: "Sector", get: (r) => r.t.sector, hidden: true },
    { id: "sf", label: "sf", get: (r) => r.t.sf, fmt: "n" },
    { id: "rent", label: "$/sf", get: (r) => r.t.rentPsf, fmt: "psf" },
    { id: "vs", label: "vs mkt", get: (r) => (mkt > 0 ? r.t.rentPsf / mkt - 1 : null), fmt: "pct", tone: (r) => (r.t.rentPsf < mkt ? "neg" : "pos") },
    { id: "yr", label: "Rent / yr", get: (r) => r.t.rentPsf * r.t.sf, fmt: "usd" },
    { id: "start", label: "Start", get: (r) => r.t.startM, cell: (r) => <span className="mono">{monthLabel(r.t.startM)}</span>, hidden: true },
    { id: "end", label: "Ends", get: (r) => r.t.endM, cell: (r) => <span className="mono">{monthLabel(r.t.endM)}</span>, tone: (r) => (r.t.endM - game.month <= 12 ? "neg" : undefined) },
    { id: "left", label: "Months", get: (r) => r.t.endM - game.month, fmt: "n" },
    { id: "credit", label: "Credit", get: (r) => r.t.credit, cell: (r) => <span>{CREDIT_LABEL[r.t.credit] ?? r.t.credit}</span> },
    { id: "bump", label: "Bump", get: (r) => r.t.bumpPct ?? 2.5, fmt: "pctv", hidden: true },
    { id: "rec", label: "Recovery", get: (r) => r.t.recovery ?? (r.t.net ? "nnn" : "gross"), hidden: true },
    { id: "free", label: "Free to", get: (r) => r.t.freeUntilM ?? null, cell: (r) => <span className="mono">{r.t.freeUntilM !== undefined && r.t.freeUntilM > game.month ? monthLabel(r.t.freeUntilM) : ""}</span>, hidden: true },
  ];
  return (
    <div className="nx-place">
      <StatStrip>
        <Stat label="Occ"><Figure value={occ.lettableOcc} fmt="pct" drill="rent" args={args} /></Stat>
        <Stat label="Leased sf"><Figure value={leased} fmt="n" drill="rent" args={args} /></Stat>
        <Stat label="Vacant sf"><Figure value={os.vacantSf} fmt="n" drill="noi" args={args} /></Stat>
        <Stat label="In place"><Figure value={avg} fmt="psf" drill="rent" args={args} /></Stat>
        <Stat label="Market"><Figure value={mkt} fmt="psf" drill="rent" args={args} /></Stat>
        <Stat label="WALT"><Figure value={h.tenants.length ? walt(h, game.month) : null} fmt="n" text={h.tenants.length ? walt(h, game.month).toFixed(1) + " y" : "—"} drill="rent" args={args} /></Stat>
        <Stat label="Roll 12m"><Figure value={leased > 0 ? roll12 / leased : null} fmt="pct" drill="rent" args={args} /></Stat>
      </StatStrip>
      <LeasingPlan h={h} bbl={bbl} />
      {lois.length > 0 && (
        <table className="nx-table">
          <thead><tr><th>Letter</th><th className="num">sf</th><th className="num">$/sf</th><th className="num">vs mkt</th><th className="num">Term</th><th className="num">To sign</th><th className="num">Answer by</th><th /></tr></thead>
          <tbody>
            {lois.map((l) => {
              const m = loiMarketPsf(game, parcels, l);
              return (
                <tr key={l.id}>
                  <td><span className="nx-strong-cell">{l.name}</span> <span className="nx-dim">{l.kind}</span></td>
                  <td className="num mono">{Math.round(l.sf).toLocaleString()}</td>
                  <td className="num mono">{l.rentPsf.toFixed(2)}</td>
                  <td className={"num mono" + (m > 0 && l.rentPsf < m ? " nx-neg" : " nx-pos")}>{m > 0 ? fmtFig(l.rentPsf / m - 1, "pct") : "—"}</td>
                  <td className="num mono">{(l.termM / 12).toFixed(l.termM % 12 ? 1 : 0)}y</td>
                  <td className="num mono">{usd(loiSigningCost(l))}</td>
                  <td className="num mono">{monthLabel(l.expiresM - 1)}</td>
                  <td className="nx-dt-act">
                    <span className="nx-row-verbs">
                      <VerbButton small v={{ label: "Sign", primary: true, run: () => useStore.getState().respondLoi(l.id, "accept") }} />
                      <VerbButton small v={{ label: "Counter", run: () => useStore.getState().setLoiFocus(l.id) }} />
                      <VerbButton small v={{ label: "Decline", run: () => useStore.getState().respondLoi(l.id, "decline") }} />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <DataTable id="file-roll" cols={cols} rows={rows} rowKey={(r) => String(r.i) + r.t.name} initialSort={{ col: "sf", dir: -1 }} empty="No leases" />
      <Desk tabs={["leasing", "ops"]} force={countering} />
    </div>
  );
}

/**
 * HOW THIS BUILDING IS LEASED (owner: the rent roll carries the choices, not
 * a desk further down). The same four standing decisions the classic leasing
 * desk sets — asking posture, letters answered for you, a listing broker, and
 * a hold that lets the roll run off — each a labelled segmented control.
 */
export function LeasingPlan({ h, bbl }: { h: Holding; bbl: string }) {
  const st = useStore.getState();
  const seg = <T,>(label: string, now: T, opts: { v: T; label: string; tip: string }[], set: (v: T) => void) => (
    <div className="nx-lp-row">
      <span className="nx-lp-k">{label}</span>
      <span className="seg" role="group" aria-label={label}>
        {opts.map((o) => (
          <button key={o.label} type="button" title={o.tip} className={"btn" + (o.v === now ? " btn-on" : "")} aria-pressed={o.v === now} onClick={() => set(o.v)}>{o.label}</button>
        ))}
      </span>
    </div>
  );
  return (
    <div className="nx-box nx-lp">
      <div className="nx-box-head nx-sec">Leasing plan</div>
      {seg("Asking", h.stance ?? 0, [
        { v: 1 as const, label: "Push +8%", tip: "Higher asking rents, fewer letters, slower lease-up" },
        { v: 0 as const, label: "Market", tip: "Ask the market rent" },
        { v: -1 as const, label: "Fill −8%", tip: "Lower asking rents, faster lease-up" },
      ], (v) => st.stance(bbl, v))}
      {seg("Letters", h.autoLease ? "auto" : h.principalSigns ? "me" : "desk", [
        { v: "me", label: "I sign", tip: "Every letter of intent pops up for you to sign, counter or decline" },
        { v: "desk", label: "Leasing desk", tip: "Your leasing desk or agent answers what it covers; the rest come to you" },
        { v: "auto", label: "Auto-answer", tip: "The building answers its own letters by the asking posture — same commission as signing yourself" },
      ], (v) => {
        if (!!h.autoLease !== (v === "auto")) st.autoLease(bbl, v === "auto");
        if (!!h.principalSigns !== (v === "me")) st.setPrincipalSigns(bbl, v === "me");
      })}
      {seg("Broker", !!h.broker, [
        { v: false, label: "In-house", tip: "Your own people: 4% on a new lease, 2% on a renewal" },
        { v: true, label: "Listing exclusive", tip: "~45% more tenant traffic on vacant space; 6% of base rent over the term when a lease signs" },
      ], (v) => st.broker(bbl, v))}
      {seg("Letting", !!h.leasingHold, [
        { v: false, label: "Open", tip: "Lease space as tenants come" },
        { v: true, label: "Hold", tip: "Stop signing — the roll runs off (clearing it for a redevelopment)" },
      ], (v) => st.holdLeasing(bbl, v))}
    </div>
  );
}

// ---------------------------------------------------------------- money
export function quotesFor(g: GameState, p: ParcelTable, bbl: string) {
  return derive(g, "next.refi:" + bbl, () => {
    const r = refiQuotes(g, p, bbl);
    return { ...r, live: r.quotes.filter((q) => q.available && q.maxProceeds > 0).sort((a, b) => a.allInPct - b.allInPct) };
  }, [p]);
}

/** The desks that will write a new loan today, cheapest first; a click takes one. */
export function RefiTable({ game, parcels, bbl, max = 8 }: { game: GameState; parcels: ParcelTable; bbl: string; max?: number }) {
  const { live, payoff, value } = useMemo(() => quotesFor(game, parcels, bbl), [game, parcels, bbl]);
  const [ask, setAsk] = useState<string | null>(null);
  // how much of each desk's maximum to draw, and which kind of paper (owner: a slider and options)
  const [lev, setLev] = useState(1);
  const [kind, setKind] = useState<"all" | "fixed" | "float">("all");
  if (!live.length) return <div className="nx-none">No quotes · value {usd(value)} · payoff {usd(payoff)}</div>;
  const shown = live.filter((q) => kind === "all" || (kind === "float") === !!q.floating);
  const cols: Col<RefiQuote>[] = [
    { id: "lender", label: "Desk", get: (q) => q.lender },
    { id: "rate", label: "Rate", get: (q) => q.ratePct, fmt: "pctv", cell: (q) => <span>{q.ratePct.toFixed(2)}%{q.floating ? " fl" : ""}</span> },
    { id: "allin", label: "All-in", get: (q) => q.allInPct, fmt: "pctv" },
    { id: "proceeds", label: "Proceeds", get: (q) => q.maxProceeds * lev, fmt: "usd" },
    { id: "net", label: "Net", get: (q) => q.maxProceeds * lev - payoff, fmt: "usd", tone: (q) => (q.maxProceeds * lev - payoff < 0 ? "neg" : "pos") },
    { id: "ltv", label: "LTV", get: (q) => q.ltvAtMax * lev, fmt: "pct" },
    // a smaller loan at the same terms carries proportionally less debt service
    { id: "dscr", label: "DSCR", get: (q) => q.dscrAtMax / Math.max(0.05, lev), fmt: "x" },
    { id: "term", label: "Term", get: (q) => q.termM / 12, fmt: "n", cell: (q) => <span>{Math.round(q.termM / 12)}y{q.ioM ? ` · IO ${q.ioM}m` : ""}</span> },
    { id: "bind", label: "Binding", get: (q) => q.binding, hidden: true },
    { id: "points", label: "Points", get: (q) => q.points * 100, fmt: "pctv", hidden: true },
  ];
  return (
    <>
    <div className="nx-refi-ctl">
      <label>Borrow <b className="mono">{Math.round(lev * 100)}%</b> of each desk's max
        <input type="range" min={0.25} max={1} step={0.05} value={lev} onChange={(e) => setLev(+e.target.value)} />
      </label>
      <span className="seg" role="group" aria-label="Rate type">
        {(["all", "fixed", "float"] as const).map((k) => (
          <button key={k} type="button" className={"btn" + (kind === k ? " btn-on" : "")} onClick={() => setKind(k)}>{k === "all" ? "All" : k === "fixed" ? "Fixed" : "Floating"}</button>
        ))}
      </span>
      <span className="nx-dim mono">payoff {usd(payoff)}</span>
    </div>
    <DataTable id="file-refi" cols={cols} rows={shown.slice(0, max)} rowKey={(q) => q.id} initialSort={{ col: "allin", dir: 1 }}
      actions={(q) => ask === q.id
        ? <span className="nx-row-verbs">
            <VerbButton small v={{ label: `Sure? ${usd(q.maxProceeds * lev)}`, primary: true, run: () => { useStore.getState().refi(bbl, q.id, lev); setAsk(null); } }} />
            <VerbButton small v={{ label: "Cancel", run: () => setAsk(null) }} />
          </span>
        : <VerbButton small v={{ label: "Take", run: () => setAsk(q.id) }} />} />
    </>
  );
}

export function MoneyTab({ game, parcels, bbl, h }: { game: GameState; parcels: ParcelTable; bbl: string; h: Holding }) {
  const rec = resolveRec(parcels, game, bbl)!;
  const value = marketAppraisal(game, rec, bbl, h.condition ?? initialCondition(rec));
  const noi = ownedHoldingNoiYr(game, parcels, h);
  const ds = ((h.loan?.monthlyPmt ?? 0) + (h.mezz?.monthlyPmt ?? 0)) * 12;
  const d = h.loan ? dscr(rec, game, h) : null;
  const l = h.loan ? ltv(rec, game, h) : null;
  const os = h.groundLeased ? null : operatingStatement(rec, game.econ, h, game.month);
  const args = { bbl };
  const loans = [h.loan ? { k: "Senior", ln: h.loan } : null, h.mezz ? { k: "Mezz", ln: h.mezz } : null].filter(Boolean) as { k: string; ln: NonNullable<Holding["loan"]> }[];
  const line = (label: string, v: number, strong?: boolean) => (
    <tr className={strong ? "nx-strong" : undefined}><td>{label}</td><td className={"num mono" + (v < 0 ? " nx-neg" : "")}>{usd(v)}</td><td className="num mono nx-dim">{os && os.egi ? fmtFig(v / os.egi, "pct") : ""}</td></tr>
  );
  return (
    <div className="nx-place">
      <StatStrip>
        <Stat label="Value"><Figure value={value} fmt="usd" drill="value" args={args} /></Stat>
        <Stat label="NOI"><Figure value={noi} fmt="usd" drill="noi" args={args} /></Stat>
        <Stat label="Debt svc"><Figure value={ds} fmt="usd" drill="dscr" args={args} /></Stat>
        <Stat label="CF / yr"><Figure value={noi - ds} fmt="usd" drill="noi" args={args} tone={noi - ds < 0 ? "neg" : undefined} /></Stat>
        <Stat label="DSCR"><Figure value={d} fmt="x" drill="dscr" args={args} tone={d !== null && h.loan && d < h.loan.minDSCR ? "neg" : undefined} /></Stat>
        <Stat label="LTV"><Figure value={l} fmt="pct" drill="value" args={args} /></Stat>
      </StatStrip>
      {os && rec.class !== "land" && rec.bldgArea > 0 && !(h.renovatingUntilM !== undefined && game.month < h.renovatingUntilM)
        && <CapitalDesk game={game} parcels={parcels} bbl={bbl} h={h} />}
      <div className="nx-cols">
        {os && (
          <div className="nx-box">
            <div className="nx-box-head">Operating · yr</div>
            <table className="nx-kv nx-kv3"><tbody>
              {line("Base rent", os.baseRent)}
              {line("Recoveries", os.recoveredOpex + os.recoveredTax)}
              {line("EGI", os.egi, true)}
              {line("Opex", -os.opex)}
              {line("Management", -os.mgmt)}
              {line("Reserves", -os.reserve)}
              {line("Tax", -os.tax)}
              {os.groundRent ? line("Ground rent", -os.groundRent) : null}
              {line("NOI", os.noi, true)}
              {line("Debt service", -ds)}
              {line("Cash flow", os.noi - ds, true)}
            </tbody></table>
          </div>
        )}
        <div className="nx-box">
          <div className="nx-box-head">Loans</div>
          {loans.length === 0 ? <div className="nx-none">None</div> : (
            <table className="nx-table"><thead><tr><th /><th className="num">Balance</th><th className="num">Rate</th><th className="num">Pmt/mo</th><th className="num">Matures</th><th className="num">Prepay</th></tr></thead>
              <tbody>
                {loans.map(({ k, ln }) => {
                  const due = payOffDue(ln, game.month, game.econ);
                  return (
                    <tr key={k} title={loanLender(ln)}>
                      <td>{k}{ln.sweep ? <span className="nx-chip nx-chip-red">Sweep</span> : null}</td>
                      <td className="num mono">{usd(ln.balance)}</td>
                      <td className="num mono">{ln.ratePct.toFixed(2)}%{ln.floating ? " fl" : ""}</td>
                      <td className="num mono">{usd(ln.monthlyPmt)}</td>
                      <td className={"num mono" + (ln.maturityM - game.month <= 12 ? " nx-neg" : "")}>{monthLabel(ln.maturityM)}</td>
                      <td className="num mono">{usd(due.penalty)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {h.loan && (
            <div className="nx-box-foot">
              <VerbButton small v={{ label: `Pay off ${usd(payOffDue(h.loan, game.month, game.econ).due)}`, disabled: game.cash < payOffDue(h.loan, game.month, game.econ).due ? "Not enough cash" : undefined, run: () => useStore.getState().payOffLoan(bbl) }} />
            </div>
          )}
        </div>
      </div>
      <div className="nx-box-head nx-sec">Refinance quotes</div>
      <RefiTable game={game} parcels={parcels} bbl={bbl} />
      <Desk tabs={["money"]} />
    </div>
  );
}
