import { useState } from "react";
import { derive } from "@/ui/derive";
import { useStore } from "@/state/store";
import type { Holding, LOI, Tenant } from "@/engine/types";
import type { ParcelRecord } from "@/data/types";
import { monthLabel, CREDIT_LABEL, autoLeaseOnClose, serviceSpec, planSpec } from "@/engine/types";
import { isLeasedFee, marketRentPsfYr, resolveRec, useRentPsfYr, recoveryOf } from "@/engine/value";
import {
  isCommercial, walt, notReadySf, vacantSf, exclusiveFeeRate, loiSigningCash,
  deskHoldsPen, deskMonthNow, loiNeedsPrincipal, portfolioOccupancy, autoTiCapToday, autoLeaseRule,
  AUTO_CONCESSIONS, autoConcessionsOf, autoLeaseYear,
} from "@/engine/leasing";
import { PlanEditor, PlanDigest } from "@/ui/panels/PlanSheet";
import { useSf } from "@/engine/mix";
import { portfolioIndustries } from "@/engine/comps";
import { INDUSTRY_LABEL } from "@/engine/market";
import { usd, sf } from "@/ui/format";
import { HousePolicy } from "@/ui/panels/HousePolicyDesk";
import { LoiCard, TrayClear } from "@/ui/panels/DealsPage";
import { useLabel, occRead, occLabel, occTitle, Big, ViewSwitch, useDeskView } from "@/ui/panels/shared";
import Fold from "@/ui/Fold";
import { Rollover } from "@/ui/rollups/Rollover";
import { WhyButton } from "@/ui/WhyChain";
import { whyGet } from "@/engine/why";
import { OpsChoices } from "@/ui/panels/OpsChoices";
import { BizLink } from "@/ui/BizSheet";
import { DataTable, rollTone, type Col } from "@/ui/next/DataTable";
import { LeasingExpiring } from "@/ui/next/LeasingNext";
import "@/ui/cleanup-leasing.css";

/**
 * LEASING: THE BOOK FIRST (ui-revamp/CLEANUP_PLAN.md §3). The page opens on
 * every lease on every building, sortable by expiry, rent against market and
 * credit; then what rolls, what is empty, the letters, and the house policy
 * last. Explanations live on the hover of the control they explain.
 */
type View = "roll" | "expiring" | "vacant" | "letters" | "policy";
const VIEWS: readonly View[] = ["roll", "expiring", "vacant", "letters", "policy"];

interface BookRow {
  h: Holding; rec: ParcelRecord; commercial: boolean; leased: number; notReady: number;
  occ: number; or: ReturnType<typeof occRead>; rentRoll: number; rolling: number; mkt: number;
}

interface LeaseRow {
  key: string; bbl: string; addr: string; t: Tenant; idx: number; mkt: number; loi?: LOI;
}

const stanceWord = (v: number) => (v > 0 ? "Push" : v < 0 ? "Fill" : "Market");

export function LeasingPage() {
  const parcels = useStore((s) => s.parcels)!;
  const game = useStore((s) => s.game)!;
  const select = useStore((s) => s.select);
  const setPage = useStore((s) => s.setPage);
  const go = (bbl: string) => { setPage("none"); select(bbl); };
  const q = game.month;
  const [view, setView] = useDeskView<View>("leasing", "roll", VIEWS);

  // Coupon-only fees: the lessee lets the tower. They must not dilute occ /
  // rent-roll totals or offer a "hire broker" button on an empty shell.
  const leasedFees = Object.values(game.holdings).flatMap((h) => {
    if (!isLeasedFee(h)) return [];
    const gl = game.groundLeases?.[h.bbl];
    if (!gl) return [];
    const rec = resolveRec(parcels, game, h.bbl);
    return [{ h, gl, rec }];
  });

  // Once per state (ui/derive): kept across visits in the same month.
  const leaseRows = derive(game, "leasing.rows", () => Object.values(game.holdings).flatMap((h): BookRow[] => {
    // A lot folded into an assemblage is part of the site's deed now — its
    // building was demolished; listing it showed buildings that no longer exist.
    if (isLeasedFee(h) || game.merged?.[h.bbl]) return [];
    const rec = resolveRec(parcels, game, h.bbl);
    if (!rec || rec.class === "land" || !rec.bldgArea) return [];
    const commercial = isCommercial(rec);
    // Both halves of a stacked building count: the shops under lease and the
    // flats above that are occupied.
    const resSf = useSf(rec, "multifamily");
    const leased = h.tenants.reduce((a, t) => a + t.sf, 0) + Math.round((h.occ ?? 0) * resSf);
    const notReady = notReadySf(h, q);
    // The leasing read, not the appraisal read — see occRead.
    const or = occRead(rec, h);
    const occ = or.lettableOcc;
    const rentRoll = h.tenants.reduce((a, t) => a + t.rentPsf * t.sf, 0)
      + resSf * useRentPsfYr(rec, game.econ, h.condition, "multifamily", h.condIdx) * (h.occ ?? 0);
    const rolling = commercial ? h.tenants.filter((t) => t.endM - q <= 12).reduce((a, t) => a + t.sf, 0) : 0;
    const mkt = marketRentPsfYr(rec, game.econ, h.condition, h.condIdx);
    return [{ h, rec, commercial, leased, notReady, occ, or, rentRoll, rolling, mkt }];
  }), [parcels]);
  // biggest building first (owner, Oct 2026); a copy, so the cached order is never disturbed
  const rows = [...leaseRows].sort((a, b) => (b.rec.bldgArea ?? 0) - (a.rec.bldgArea ?? 0));

  const desk = game.lois.filter((l) => loiNeedsPrincipal(game, l));
  const ind = derive(game, "leasing.industries", () => portfolioIndustries(game));

  // Portfolio occupancy over LETTABLE feet, from the SAME function the top
  // bar reads: one function, one answer.
  const totRemainder = rows.reduce((a, r) => a + r.or.remainderSf, 0);
  const po = portfolioOccupancy(game, parcels);
  const totSf = po?.lettableSf ?? 0;
  const totLeased = po?.leasedSf ?? 0;
  const totRoll = rows.reduce((a, r) => a + r.rentRoll, 0);
  const totRolling = rows.reduce((a, r) => a + r.rolling, 0);

  // EVERY LEASE ON EVERY BUILDING, with the letter that tenant has sent, if any.
  const leases: LeaseRow[] = rows.flatMap((r) => r.h.tenants.map((t, idx) => ({
    key: `${r.h.bbl}:${idx}`, bbl: r.h.bbl, addr: r.rec.address || r.h.bbl, t, idx, mkt: r.mkt,
    loi: desk.find((l) => l.bbl === r.h.bbl && l.tenantIdx === idx),
  })));
  const rolling12 = leases.filter((l) => l.t.endM - q <= 12).length;
  const vacantN = rows.filter((r) => vacantSf(r.rec, r.h) > 0).length;

  return (
    <div className="lz">
      <div className="stat-strip">
        <Big
          label="Occupancy"
          value={totSf ? ((100 * Math.min(totLeased, totSf)) / totSf).toFixed(1) + "%" : "—"}
          bad={totSf > 0 && totLeased / totSf < 0.8}
          title={totRemainder
            ? `Leasable basis. ${sf(totRemainder)} below minimum suite size excluded.`
            : "Leased sf / leasable sf."}
        />
        <Big label="Leased" value={sf(totLeased) + " of " + sf(totSf)} />
        <Big label="Rent roll / yr" value={usd(totRoll)} />
        <Big label="Rolling in 12 mo" value={sf(totRolling)} bad={totRolling > totLeased * 0.25} />
        <Big label="Letters" value={String(desk.length)} title="Awaiting your decision (also on Deals)" />
      </div>
      <ViewSwitch<View>
        label="Leasing"
        on={view}
        set={setView}
        views={[
          { id: "roll", label: "Rent roll", n: leases.length, title: "Every lease on every building" },
          { id: "expiring", label: "Expiring", n: rolling12, title: "Leases rolling in the next three years; the count is the next twelve months" },
          { id: "vacant", label: "Vacant", n: vacantN, title: "Each building's occupancy, empty space and rent against market" },
          { id: "letters", label: "Letters", n: desk.length, title: "Letters of intent and renewals waiting for you" },
          { id: "policy", label: "Policy", title: "House policy, auto-lease, who signs, and per-building overrides" },
        ]}
      />
      {view === "roll" && (
        <>
          <RentRoll leases={leases} game={game} q={q} go={go}
            counter={(id) => { useStore.getState().setLoiFocus(id); setView("letters"); }}
            empty={totLeased > 0 ? `None named · ${sf(totLeased)} leased as apartments` : "None"} />
          <LeasedFees fees={leasedFees} go={go} />
          {ind.rows.length > 0 && (
            <div className="page-section">
              <div className="page-section-head"
                title={ind.top && ind.top.share > 0.45
                  ? `${(ind.top.share * 100).toFixed(0)}% of rent from ${INDUSTRY_LABEL[ind.top.sector].toLowerCase()}. Concentration discounted by buyers and lenders.`
                  : "Diversified. Lenders and buyers discount single-industry concentration."}>
                Exposure by industry{ind.atRisk > 0.18 ? ` · ${(ind.atRisk * 100).toFixed(0)}% contracting` : ""}
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Industry</th><th className="num">Share</th><th className="num">Income / yr</th>
                    <th className="num">Space</th><th className="num">Tenants</th><th>Cycle</th>
                  </tr>
                </thead>
                <tbody>
                  {ind.rows.map((r) => (
                    <tr key={r.sector} className={r.stress > 0.4 ? "dim" : ""}>
                      <td>{INDUSTRY_LABEL[r.sector]}</td>
                      <td className={"num" + (r.share > 0.45 ? " neg" : "")}>{(r.share * 100).toFixed(0)}%</td>
                      <td className="num">{usd(r.income)}</td>
                      <td className="num">{sf(r.sf)}</td>
                      <td className="num">{r.tenants}</td>
                      <td className={r.phase === "bust" ? "neg" : "dim"}>
                        {r.phase === "boom" ? "expanding" : r.phase === "bust" ? "contracting" : "steady"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {view === "expiring" && (
        <>
          <LeasingExpiring />
          {/* Which YEAR the leases roll. */}
          <Rollover />
        </>
      )}
      {view === "vacant" && <Buildings rows={rows} go={go} />}
      {view === "letters" && <Letters desk={desk} go={go} />}
      {view === "policy" && <Policy rows={rows} go={go} />}
    </div>
  );
}

function RentRoll({ leases, game, q, go, counter, empty }: {
  leases: LeaseRow[]; game: NonNullable<ReturnType<typeof useStore.getState>["game"]>; q: number;
  go: (bbl: string) => void; counter: (id: number) => void; empty: string;
}) {
  const vs = (r: LeaseRow) => (r.mkt > 0 ? r.t.rentPsf / r.mkt - 1 : null);
  const cols: Col<LeaseRow>[] = [
    {
      id: "tenant", label: "Tenant", get: (r) => r.t.name,
      cell: (r) => <span title={`${r.t.sector}${r.t.quality !== undefined ? ` · quality ${r.t.quality}` : ""}`}><BizLink t={r.t} /></span>,
    },
    { id: "addr", label: "Building", get: (r) => r.addr },
    { id: "sector", label: "Sector", get: (r) => r.t.sector, hidden: true },
    { id: "credit", label: "Credit", get: (r) => r.t.credit, cell: (r) => CREDIT_LABEL[r.t.credit] ?? "—", tone: (r) => (r.t.credit === 0 ? "neg" : undefined) },
    { id: "sf", label: "sf", get: (r) => r.t.sf, fmt: "n" },
    { id: "rent", label: "$/sf", get: (r) => r.t.rentPsf, fmt: "psf" },
    { id: "vs", label: "vs mkt", get: vs, fmt: "pct", tone: (r) => rollTone(vs(r)) },
    {
      id: "recov", label: "Terms", get: (r) => recoveryOf(r.t), hidden: true,
      cell: (r) => { const rv = recoveryOf(r.t); return rv === "nnn" ? "NNN" : rv === "base" ? `base yr · stop $${(r.t.baseStopPsf ?? 0).toFixed(2)}` : "gross"; },
    },
    { id: "end", label: "Expires", get: (r) => r.t.endM, cell: (r) => <span className="mono">{monthLabel(r.t.endM)}</span>, tone: (r) => (r.t.endM - q <= 12 ? "neg" : undefined) },
    { id: "left", label: "Months", get: (r) => r.t.endM - q, fmt: "n" },
  ];
  return (
    <DataTable id="leasing-book" cols={cols} rows={leases} rowKey={(r) => r.key}
      initialSort={{ col: "end", dir: 1 }} empty={empty} maxHeight={560}
      onRow={(r) => go(r.bbl)}
      actions={(r) => {
        const loi = r.loi;
        if (!loi) return null;
        // THE TENANT'S LETTER, ON THE TENANT'S ROW: the same respondLoi the
        // letter card calls, with the same cash test for drawing the line.
        const short = loiSigningCash(loi, exclusiveFeeRate(game.holdings[loi.bbl])) > game.cash;
        const res = (a: "accept" | "decline") => useStore.getState().respondLoi(loi.id, a, a === "accept" ? short : undefined);
        return (
          <span className="lz-acts" title={`${loi.kind} letter · $${loi.rentPsf.toFixed(2)}/sf · ${(loi.termM / 12).toFixed(loi.termM % 12 ? 1 : 0)} yr · answer by ${monthLabel(loi.expiresM - 1)}`}>
            <button type="button" className="btn btn-mini btn-buy" onClick={() => res("accept")}>Accept</button>
            <button type="button" className="btn btn-mini" onClick={() => counter(loi.id)}>Counter</button>
            <button type="button" className="btn btn-mini" onClick={() => res("decline")}>Decline</button>
          </span>
        );
      }} />
  );
}

function LeasedFees({ fees, go }: { fees: { h: Holding; gl: { tenant: string; rentYr: number; endM: number }; rec: ParcelRecord | null | undefined }[]; go: (bbl: string) => void }) {
  if (!fees.length) return null;
  return (
    <div className="page-section">
      <div className="page-section-head" title="Ground rent only; lessee manages the building.">Leased fees</div>
      <table className="tbl">
        <thead>
          <tr><th>Property</th><th>Lessee</th><th className="num">Ground rent / yr</th><th className="num">Reverts</th></tr>
        </thead>
        <tbody>
          {fees.map(({ h, gl, rec }) => (
            <tr key={h.bbl} onClick={() => go(h.bbl)}>
              <td>{rec?.address ?? h.bbl}</td>
              <td className="dim">{gl.tenant}</td>
              <td className="num">{usd(gl.rentYr)}</td>
              <td className="num">{monthLabel(gl.endM)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Each building: occupancy, empty space, rent in place against market. */
function Buildings({ rows, go }: { rows: BookRow[]; go: (bbl: string) => void }) {
  const game = useStore((s) => s.game)!;
  const q = game.month;
  const avg = (r: BookRow) => (r.leased > 0 ? r.rentRoll / r.leased : 0);
  const gap = (r: BookRow) => (avg(r) > 0 && r.mkt > 0 ? avg(r) / r.mkt - 1 : null);
  const cols: Col<BookRow>[] = [
    { id: "addr", label: "Property", get: (r) => r.rec.address },
    { id: "type", label: "Type", get: (r) => useLabel(r.rec) },
    { id: "bsf", label: "Bldg sf", get: (r) => r.rec.bldgArea, fmt: "n", hidden: true },
    {
      id: "occ", label: "Occ", get: (r) => r.occ, num: true, tone: (r) => (r.occ < 0.75 ? "neg" : undefined),
      cell: (r) => {
        // WHY A FLAT EMPTIED: the households that left this month (households.ts)
        const id = game.households?.flatWhy?.[r.h.bbl];
        const ev = whyGet(game, id);
        const n = ev && ev.m === game.month ? ev.n?.households ?? 0 : 0;
        return (
          <span title={occTitle(r.or)}>
            {occLabel(r.or)}
            {n > 0 && <span className="dim"> · {n} left <WhyButton id={id} /></span>}
          </span>
        );
      },
    },
    { id: "vac", label: "Vacant sf", get: (r) => vacantSf(r.rec, r.h), fmt: "n" },
    { id: "avg", label: "In place", get: (r) => avg(r) || null, fmt: "psf" },
    { id: "mkt", label: "Market", get: (r) => r.mkt || null, fmt: "psf" },
    { id: "gap", label: "vs mkt", get: gap, fmt: "pct", tone: (r) => rollTone(gap(r)) },
    { id: "roll", label: "Rent / yr", get: (r) => r.rentRoll, fmt: "usd" },
    { id: "walt", label: "WALT", get: (r) => (r.commercial ? walt(r.h, q) : null), num: true, cell: (r) => (r.commercial ? walt(r.h, q).toFixed(1) + "y" : "—") },
    { id: "rolling", label: "Rolling 12m", get: (r) => r.rolling || null, fmt: "n", hidden: true, tone: (r) => (r.rolling > r.leased * 0.3 ? "neg" : undefined) },
    {
      id: "status", label: "Status",
      get: (r) => [
        r.h.broker ? "broker" : "",
        r.h.autoLease ? "auto" : "",
        r.notReady ? "turning" : "",
        r.h.deliveredM !== undefined && q - r.h.deliveredM <= 30 ? "lease-up" : "",
      ].filter(Boolean).join(" · ") || null,
    },
  ];
  return (
    <DataTable id="leasing-bldgs" cols={cols} rows={rows} rowKey={(r) => r.h.bbl}
      initialSort={{ col: "vac", dir: -1 }} empty="None" onRow={(r) => go(r.h.bbl)}
      actions={(r) => (r.commercial && !r.h.broker && vacantSf(r.rec, r.h) > 0 && r.rec.bldgArea - r.leased > 500
        ? <button type="button" className="btn btn-mini" title="Listing broker: sources tenants, you sign"
            onClick={() => useStore.getState().broker(r.h.bbl, true)}>Broker</button>
        : null)} />
  );
}

/** The letters themselves: the same cards, same predicate, same order as Deals. */
function Letters({ desk, go }: { desk: LOI[]; go: (bbl: string) => void }) {
  const game = useStore((s) => s.game)!;
  const tally = deskHoldsPen(game) ? deskMonthNow(game) : null;
  return (
    <>
      {/* QUIET ACCOUNTABILITY: when somebody else holds the pen, the tally is
          the proof the desk is working. */}
      {tally && (
        <div className="stat-strip">
          <Big label="Signed" value={String(tally.signed)} title="Signed within mandate this month" />
          <Big label="Passed" value={String(tally.passed)}
            title={tally.signed === 0 && tally.passed > 0 && tally.referred === 0
              ? "Below mandate; declined. Passes only: mandate may be above market."
              : "Below mandate; declined"} />
          <Big label="Referred" value={String(tally.referred)} title="Expansions, capital calls, ties, failed counters" />
          <Big label="Walked" value={String(tally.walked)} title="Left after counter" />
          <Big label="Countered" value={String(tally.countered)} title="Countered to mandate" />
        </div>
      )}
      {!desk.length ? <div className="dim lz-none">None</div> : (
        <>
          <TrayClear />
          <div className="loi-grid">
            {[...desk]
              .sort((a, b) => (b.referred ? 1 : 0) - (a.referred ? 1 : 0)
                || (a.tourId ?? -a.id) - (b.tourId ?? -b.id) || a.id - b.id)
              .map((loi) => <LoiCard key={loi.id} loi={loi} go={go} />)}
          </div>
        </>
      )}
    </>
  );
}

/** A switch row: label (explained on hover), then the choice. */
function Opt({ label, title, children }: { label: string; title?: string; children: React.ReactNode }) {
  return (
    <div className="ops-choice">
      <span className={"ops-choice-k" + (title ? " has-gloss" : "")} title={title}>{label}</span>
      {children}
    </div>
  );
}

function Policy({ rows, go }: { rows: BookRow[]; go: (bbl: string) => void }) {
  const game = useStore((s) => s.game)!;
  const { setAgent, setRenewalMgmt } = useStore.getState();
  const book = rows.filter((r) => r.commercial);
  const on = book.filter((r) => r.h.autoLease).length;
  const allOn = book.length > 0 && on === book.length;
  const conc = autoConcessionsOf(game);
  const yr = autoLeaseYear(game);
  const settled = yr.signed + yr.passed + yr.walked + yr.referred;
  const pctOf = (x: number) => `${Math.round(x * 100)}%`;
  const referred = (game.lois ?? []).filter((l) => loiNeedsPrincipal(game, l)).length;
  const newOn = autoLeaseOnClose(game);
  return (
    <>
      <HousePolicy />
      {/* THE TEAM, IN ONE BLOCK: how much the team may give away, the book
          switched on, and the scorecard. Rent posture stays per building. */}
      {book.length > 0 && (
        <div className="page-section">
          <div className="page-section-head"
            title={`TI and free rent: ${AUTO_CONCESSIONS.find((o) => o.key === conc)!.blurb}, vs market package per space. Rent setting per building. Leases ≥ 25% of building (10,000 sf+) referred to you.`}>
            Auto-lease · {on} of {book.length}
          </div>
          <Opt label="All buildings" title={allOn
            ? "All buildings on auto-lease. Click to disable."
            : "Auto-lease all buildings at their Fill / Market / Push setting and the concession limit."}>
            <button type="button" className={"btn btn-sm" + (allOn ? " btn-on" : "")} aria-pressed={allOn}
              onClick={() => {
                // the whole book on (or off) is the instruction for the next deed too
                useStore.getState().autoLease(book.map((r) => r.h.bbl), !allOn);
                useStore.getState().autoLeaseNew(!allOn);
              }}>{allOn ? "On" : "Off"}</button>
          </Opt>
          <Opt label="Concessions" title="The most TI and free rent the team may give, against the market package for each space.">
            <span className="seg" role="group" aria-label="Max TI and free rent">
              {AUTO_CONCESSIONS.map((o) => (
                <button key={o.key} type="button" className={"btn btn-sm" + (conc === o.key ? " btn-on" : "")}
                  aria-pressed={conc === o.key} title={`${o.label}: ${o.blurb}.`}
                  onClick={() => useStore.getState().autoConcessions(o.key)}>{o.label}</button>
              ))}
            </span>
          </Opt>
          <Opt label="Rent floor" title={game.autoRentFloor
            ? "No leases, renewals or relief below market rent. Click to disable."
            : "Floor face rent at market: counter up or pass. Slower lease-up."}>
            <button type="button" className={"btn btn-sm" + (game.autoRentFloor ? " btn-on" : "")} aria-pressed={!!game.autoRentFloor}
              onClick={() => useStore.getState().autoRentFloor(!game.autoRentFloor)}>{game.autoRentFloor ? "Market" : "Off"}</button>
          </Opt>
          <Opt label="New buildings" title={newOn
            ? "Acquisitions start on auto-lease at house setting. Click to disable."
            : "Start acquisitions on auto-lease."}>
            <button type="button" className={"btn btn-sm" + (newOn ? " btn-on" : "")} aria-pressed={newOn}
              onClick={() => useStore.getState().autoLeaseNew(!newOn)}>{newOn ? "Join" : "Off"}</button>
          </Opt>
          <Opt label="Last 12 mo" title="What the team settled in the last twelve months; deal and net effective against market.">
            <span className="ops-choice-read mono">
              {!settled ? "none" : <>
                {yr.signed} signed{yr.signed > 0 && <> · {pctOf(yr.deal)} deal · {pctOf(yr.ne)} NE{yr.under ? ` · ${yr.under} <90%` : ""}</>}
                {" · "}{yr.passed} passed · {yr.walked} walked · {yr.referred} referred
              </>}
            </span>
          </Opt>
        </div>
      )}
      {/* WHO HOLDS THE PEN. The agent takes the whole book at 6%; management
          takes only the renewals at +2% (leaseCosts prices a renewal at 2%
          against a new lease's 4%). Hidden while the agent has the book. */}
      <div className="page-section">
        <div className="page-section-head">Who signs</div>
        <Opt label="Leasing" title={game.agent
          ? `Outside agent: 6% fee. Signs to plan, counters, declines weak LOIs, refers exceptions${referred ? ` · ${referred} LOI${referred === 1 ? "" : "s"} referred` : ""}.`
          : "In-house: all LOIs come to you. Listing brokers source but do not sign. Options: renewals to management or outside agent at 6%."}>
          <span className="seg" role="group" aria-label="Who signs leases">
            <button type="button" className={"btn btn-sm" + (!game.agent ? " btn-on" : "")} aria-pressed={!game.agent}
              onClick={() => game.agent && setAgent(false)}>In-house</button>
            <button type="button" className={"btn btn-sm" + (game.agent ? " btn-on" : "")} aria-pressed={!!game.agent}
              onClick={() => !game.agent && setAgent(true)}>Agent · 6%</button>
          </span>
        </Opt>
        {!game.agent && (
          <Opt label="Renewals" title={game.renewalMgmt
            ? "Signed within mandate. +2% of lease value (4% total). Weak renewals referred; junk passed. New leases stay with you."
            : "Renewal LOIs arrive 6 mo before expiry; 2% commission. Management: +2%, new leases stay with you."}>
            <span className="seg" role="group" aria-label="Who signs renewals">
              <button type="button" className={"btn btn-sm" + (!game.renewalMgmt ? " btn-on" : "")} aria-pressed={!game.renewalMgmt}
                onClick={() => game.renewalMgmt && setRenewalMgmt(false)}>In-house</button>
              <button type="button" className={"btn btn-sm" + (game.renewalMgmt ? " btn-on" : "")} aria-pressed={!!game.renewalMgmt}
                onClick={() => !game.renewalMgmt && setRenewalMgmt(true)}>Management · 2%</button>
            </span>
          </Opt>
        )}
        <MinLeaseAll />
      </div>
      <Overrides rows={rows} go={go} />
      <Fold id="leasing:mandate" title="Leasing plan">
        <PlanEditor />
        <PlanDigest />
      </Fold>
    </>
  );
}

/**
 * PER-BUILDING OVERRIDES, ONLY WHERE THEY EXIST. A building is listed when it
 * runs something other than the house policy (asking rents, service, capital
 * plan, auto-lease, or you sign there). Any other building can be set apart
 * from the "Override…" menu.
 */
function Overrides({ rows, go }: { rows: BookRow[]; go: (bbl: string) => void }) {
  const game = useStore((s) => s.game)!;
  const [extra, setExtra] = useState<string[]>([]);
  const house = game.opsPolicy ?? { service: 0 as const, plan: 1 as const, stance: 0 as const };
  const newOn = autoLeaseOnClose(game);
  const differs = (r: BookRow) => (r.h.stance ?? 0) !== (house.stance ?? 0)
    || (r.h.service ?? 0) !== house.service
    || (r.h.plan ?? 1) !== house.plan
    || !!r.h.principalSigns
    || (r.commercial && !!r.h.autoLease !== newOn);
  const shown = rows.filter((r) => differs(r) || extra.includes(r.h.bbl));
  const rest = rows.filter((r) => !shown.includes(r));
  const reset = (r: BookRow) => {
    const st = useStore.getState();
    st.stance(r.h.bbl, (house.stance ?? 0) as -1 | 0 | 1);
    st.ops(r.h.bbl, { service: house.service, plan: house.plan });
    if (r.h.principalSigns) st.setPrincipalSigns(r.h.bbl, false);
    if (r.commercial && !!r.h.autoLease !== newOn) st.autoLease(r.h.bbl, newOn);
    setExtra((x) => x.filter((b) => b !== r.h.bbl));
  };
  return (
    <div className="page-section">
      <div className="page-section-head lz-head"
        title="Buildings running something other than the house policy. Each building can also be set on its own card.">
        <span>Overrides · {shown.length}</span>
        {rest.length > 0 && (
          <select className="lz-pick" value="" aria-label="Override a building"
            onChange={(e) => e.target.value && setExtra((x) => [...x, e.target.value])}>
            <option value="">Override…</option>
            {rest.map((r) => <option key={r.h.bbl} value={r.h.bbl}>{r.rec.address || r.h.bbl}</option>)}
          </select>
        )}
      </div>
      {!shown.length && <div className="dim lz-none">None</div>}
      {shown.map((r) => {
        const cap = r.h.autoLease ? autoTiCapToday(game, r.h) : undefined;
        return (
          <div key={r.h.bbl} className="lz-ovr">
            <div className="lz-ovr-head">
              <a onClick={() => go(r.h.bbl)}><b>{r.rec.address || r.h.bbl}</b></a>
              <span className="dim" title="What differs from the house policy">{[
                (r.h.stance ?? 0) !== (house.stance ?? 0) ? `rents ${stanceWord(r.h.stance ?? 0).toLowerCase()}` : "",
                (r.h.service ?? 0) !== house.service ? `service ${serviceSpec(r.h.service).label.toLowerCase()}` : "",
                (r.h.plan ?? 1) !== house.plan ? `capex ${planSpec(r.h.plan).label.toLowerCase()}` : "",
                r.commercial && !!r.h.autoLease !== newOn ? `auto ${r.h.autoLease ? "on" : "off"}` : "",
                r.h.principalSigns ? "you sign" : "",
              ].filter(Boolean).join(" · ") || "as house"}{cap !== undefined ? ` · TI ≤ $${cap.toFixed(2)}/yr` : ""}</span>
              {differs(r) && (
                <button type="button" className="btn btn-mini" title="Back to the house policy" onClick={() => reset(r)}>House</button>
              )}
            </div>
            <div className="ops-choice">
              <span className="ops-choice-k">Asking</span>
              <span className="seg" role="group" aria-label={`Asking rents at ${r.rec.address}`}>
                {([-1, 0, 1] as const).map((v) => (
                  <button key={v} type="button" className={"btn btn-sm" + ((r.h.stance ?? 0) === v ? " btn-on" : "")}
                    title={v === 1 ? "+8% asking rents, fewer LOIs" : v === -1 ? "−8% rents, faster lease-up" : "Market rents"}
                    aria-pressed={(r.h.stance ?? 0) === v}
                    onClick={() => useStore.getState().stance(r.h.bbl, v)}>{v === 1 ? "Push" : v === -1 ? "Fill" : "Market"}</button>
                ))}
              </span>
              <button type="button" className={"btn btn-sm" + (r.h.autoLease ? " btn-on" : "")} aria-pressed={!!r.h.autoLease}
                title={r.h.autoLease ? `${autoLeaseRule(game, r.h)} Click to disable.` : "Auto-respond to LOIs at rent setting and concession limit."}
                onClick={() => useStore.getState().autoLease(r.h.bbl, !r.h.autoLease)}>Auto</button>
              {r.commercial && (
                <button type="button" className={"btn btn-sm" + (r.h.principalSigns ? " btn-on" : "")} aria-pressed={!!r.h.principalSigns}
                  title={r.h.principalSigns
                    ? "All LOIs here come to you. Click to return to agent."
                    : "Route this building's LOIs to you regardless of agent."}
                  onClick={() => useStore.getState().setPrincipalSigns(r.h.bbl, !r.h.principalSigns)}>I sign</button>
              )}
            </div>
            <OpsChoices bbl={r.h.bbl} h={r.h} compact />
          </div>
        );
      })}
    </div>
  );
}

/**
 * ONE MINIMUM NEW LEASE FOR THE WHOLE BOOK. The per-building floor ("Smallest
 * deal you'll sign" on each property) set once for every building you own,
 * and kept as the house default so buildings you buy or deliver later open on
 * it. Each building can still be set apart on its own desk. 0 clears it.
 */
function MinLeaseAll() {
  const game = useStore((s) => s.game)!;
  const house = game.minLeaseDefault ?? 0;
  const [v, setV] = useState<string>(house ? String(house) : "");
  const n = Number(v === "" ? 0 : v);
  const valid = Number.isFinite(n) && n >= 0;
  const changed = valid && Math.round(n) !== house;
  return (
    <Opt label="Min. new lease" title="Minimum new lease size, all buildings and future acquisitions. Renewals, expansions, full-vacancy deals and apartments exempt. Override per building.">
      <input type="number" step="500" min="0" value={v} placeholder="any" className="lz-num"
        aria-label="Minimum new lease, sf"
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && changed) useStore.getState().minLeaseAll(n); }} />
      <span className="ops-choice-read">sf</span>
      <button type="button" className="btn btn-sm" disabled={!changed}
        onClick={() => useStore.getState().minLeaseAll(n)}>
        {n > 0 ? "Set on all" : "Clear all"}
      </button>
    </Opt>
  );
}
