// THE MONTH, ATTRIBUTED.
//
// Net worth is one number and it moves for a dozen reasons at once — rent
// collected, a mortgage amortising, a building repricing under a new cap
// rate, a deed arriving or leaving. The top bar says WHICH WAY it moved;
// this card says WHY, in two ledgers: the cash that actually crossed the
// account (the same BooksMonth buckets the income statement reads) and the
// marks (the same ownedHoldingValue every balance sheet and lender reads).
// Nothing here is re-derived — one quantity, one function, everywhere.
import { useMemo } from "react";
import { useStore } from "@/state/store";
import { monthLabel } from "@/engine/types";
import type { BooksMonth, GameState } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import { ownedHoldingValue, resolveRec } from "@/engine/value";
import { depositsHeld } from "@/engine/leasing";
import { usd } from "@/ui/format";
import "./vitals.css";

/**
 * The pre-advance snapshot is UI-only and is NOT cleared when a save is
 * loaded mid-session, so it can belong to a different campaign or to a
 * later month of this one. A diff against the wrong world would read as
 * every deed being new. Same town, strictly earlier, and no further back
 * than the longest skip (36 months) — otherwise the card falls back to the
 * ledger alone.
 */
export function usablePrev(game: GameState, prev: GameState | null): GameState | null {
  if (!prev) return null;
  if (prev.citySeed !== game.citySeed) return null;
  if (!(prev.month < game.month) || game.month - prev.month > 36) return null;
  return prev;
}

// The ledger's own buckets, in the statement's own order. `sign` is the
// direction of the cash: the ledger stores magnitudes.
const CASH_SPECS: {
  key: keyof Omit<BooksMonth, "m">; label: string; sign: 1 | -1; note?: string;
}[] = [
  { key: "noi", label: "Property NOI", sign: 1, note: "rents less operating costs and property tax" },
  { key: "interest", label: "Interest on cash", sign: 1 },
  { key: "sold", label: "Disposition proceeds", sign: 1, note: "net of loan payoff" },
  { key: "borrowed", label: "Debt drawn", sign: 1, note: "cash-out refinance and facility draws" },
  { key: "lpCalled", label: "LP capital called", sign: 1, note: "into the vehicle — equity in, not income" },
  { key: "debtSvc", label: "Debt service", sign: -1, note: "interest, amortisation, fees" },
  { key: "leasing", label: "Leasing costs", sign: -1, note: "fit-out and commissions" },
  { key: "capex", label: "Capital expenditure", sign: -1 },
  { key: "dev", label: "Development", sign: -1, note: "equity into the ground, construction carry" },
  { key: "taxes", label: "Taxes", sign: -1 },
  { key: "bought", label: "Acquisitions", sign: -1, note: "equity out the door at closing" },
  { key: "ga", label: "Firm overhead", sign: -1 },
  { key: "lpDistributed", label: "LP distributions", sign: -1, note: "out of the vehicle — equity out, not expense" },
];

interface WfCashRow { key: string; label: string; amount: number; note?: string }
interface WfValueLine { key: string; label: string; amount: number }

interface WfModel {
  windowLabel: string;
  months: number;
  hasPrev: boolean;
  cashRows: WfCashRow[];
  cashNet: number;
  exits: WfValueLine[];    // deeds that left the book — marks removed
  entries: WfValueLine[];  // deeds that arrived — marks added
  revals: WfValueLine[];   // surviving deeds, sorted by |Δ| descending
  valueNet: number;
  dNw: number | null;
  resid: number | null;
  empty: boolean;
}

function buildModel(game: GameState, prevRaw: GameState | null, parcels: ParcelTable | null): WfModel {
  const prev = usablePrev(game, prevRaw);
  const hasPrev = prev !== null;
  const booksAll = game.booksMonthly ?? [];

  // The window: everything since the pre-advance snapshot — one month after
  // Advance, several after Yr / Skip. With no snapshot (a fresh session) the
  // ledger is all that survived the reload, so the cash side falls back to
  // the newest recorded month and the value side waits for the next advance.
  let span: BooksMonth[];
  let windowLabel: string;
  let months = 1;
  if (prev) {
    months = game.month - prev.month;
    span = booksAll.filter((b) => b.m > prev.month && b.m <= game.month);
    windowLabel = months > 1 ? `since ${monthLabel(prev.month)}` : monthLabel(game.month);
  } else {
    span = booksAll.filter((b) => b.m === game.month);
    if (!span.length && booksAll.length) span = [booksAll[booksAll.length - 1]];
    windowLabel = monthLabel(span.length ? span[span.length - 1].m : game.month);
  }

  const cashRows: WfCashRow[] = [];
  let cashNet = 0;
  for (const spec of CASH_SPECS) {
    let v = 0;
    for (const b of span) v += b[spec.key] ?? 0;
    if (!v) continue;
    const amount = spec.sign * v;
    cashNet += amount;
    cashRows.push({ key: spec.key, label: spec.label, amount, note: spec.note });
  }
  if (prev) {
    // Two movements that are cash without being income or expense — the same
    // two the conservation identity carries outside the buckets. Labelled as
    // balance-sheet moves because a drawn line looks exactly like earnings
    // until the day it is due back.
    const dLoc = (game.loc?.balance ?? 0) - (prev.loc?.balance ?? 0);
    if (dLoc !== 0) {
      cashNet += dLoc;
      cashRows.push({ key: "loc", label: "Credit line", amount: dLoc, note: "balance-sheet move — borrowed cash, not income" });
    }
    const dDep = depositsHeld(game) - depositsHeld(prev);
    if (dDep !== 0) {
      cashNet += dDep;
      cashRows.push({ key: "deposits", label: "Tenant deposits", amount: dDep, note: "balance-sheet move — held for tenants, not earned" });
    }
  }

  // The value side: every surviving deed appraised in both worlds, each with
  // its own econ and its own ground-lease facts. This is the expensive walk —
  // two full appraisals of the book — which is why the component only exists
  // while somebody is looking at it.
  const exits: WfValueLine[] = [];
  const entries: WfValueLine[] = [];
  const revals: WfValueLine[] = [];
  let valueNet = 0;
  if (prev && parcels) {
    for (const h of Object.values(game.holdings)) {
      const ph = prev.holdings[h.bbl];
      const nv = ownedHoldingValue(game, parcels, h);
      const label = resolveRec(parcels, game, h.bbl)?.address ?? h.bbl;
      if (ph) {
        const d = nv - ownedHoldingValue(prev, parcels, ph);
        if (d) { valueNet += d; revals.push({ key: h.bbl, label, amount: d }); }
      } else if (nv) {
        valueNet += nv;
        entries.push({ key: h.bbl, label: `${label} — new deed`, amount: nv });
      }
    }
    // Deeds that left. `exits` carries the sales; keys handed back, seizures
    // and merges leave the book the same way without a sale record, and the
    // section is only honest if their departed marks are counted too.
    const gone = new Set<string>();
    for (const e of game.exits ?? []) {
      if (e.soldM <= (prev.month) || e.soldM > game.month) continue;
      gone.add(e.bbl);
      const ph = prev.holdings[e.bbl];
      const pv = ph ? ownedHoldingValue(prev, parcels, ph) : 0;
      if (pv) { valueNet -= pv; exits.push({ key: `x:${e.bbl}:${e.soldM}`, label: `${e.address} — sold`, amount: -pv }); }
    }
    for (const ph of Object.values(prev.holdings)) {
      if (game.holdings[ph.bbl] || gone.has(ph.bbl)) continue;
      const pv = ownedHoldingValue(prev, parcels, ph);
      if (!pv) continue;
      valueNet -= pv;
      const label = resolveRec(parcels, prev, ph.bbl)?.address ?? ph.bbl;
      exits.push({ key: `left:${ph.bbl}`, label: `${label} — left the book`, amount: -pv });
    }
    revals.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  }

  // ΔNW from the same tape the chart draws — nwHistory index i is month i.
  const nh = game.nwHistory ?? [];
  const endM = prev ? game.month : (span.length ? span[span.length - 1].m : game.month);
  const startM = prev ? prev.month : endM - 1;
  const nwNow = nh[endM];
  const nwThen = startM >= 0 ? nh[startM] : undefined;
  const dNw = nwNow !== undefined && nwThen !== undefined ? nwNow - nwThen : null;
  // Only reconcile when both sides were actually computed; against a
  // cash-only fallback the residual would just be the missing value section.
  const resid = hasPrev && dNw !== null ? dNw - (cashNet + valueNet) : null;

  return {
    windowLabel, months, hasPrev, cashRows, cashNet, exits, entries, revals, valueNet, dNw, resid,
    empty: !cashRows.length && !exits.length && !entries.length && !revals.length,
  };
}

/** Explicit sign always — the fill colour repeats it, never replaces it. */
const signed = (n: number) => (n < 0 ? usd(n) : "+" + usd(n));

function WfRow({ label, note, amount, max }: {
  label: string; note?: string; amount: number; max: number;
}) {
  const w = max > 0 ? Math.max(2, Math.round((Math.abs(amount) / max) * 100)) : 0;
  return (
    <div className="wf-row">
      <span className="wf-row-label" title={note ? `${label} · ${note}` : label}>
        {label}
        {note && <span className="wf-note"> · {note}</span>}
      </span>
      <span className="wf-track" aria-hidden="true">
        <span
          className={"wf-fill " + (amount >= 0 ? "wf-fill-in" : "wf-fill-out")}
          style={{ width: `${w}%` }}
        />
      </span>
      <span className={"wf-amt mono" + (amount < 0 ? " wf-amt-neg" : "")}>{signed(amount)}</span>
    </div>
  );
}

function WfTotal({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="wf-row wf-total">
      <span className="wf-row-label">{label}</span>
      <span aria-hidden="true" />
      <span className={"wf-amt mono" + (amount < 0 ? " wf-amt-neg" : "")}>{signed(amount)}</span>
    </div>
  );
}

/**
 * The waterfall between the last decision point and now. Full form opens the
 * Books page; `compact` is the same card sized for the top-bar popover. Reads
 * GameState only — every number comes from the ledger or from the one
 * valuation function the rest of the game already trusts.
 */
export default function Waterfall({ compact }: { compact?: boolean }) {
  const game = useStore((s) => s.game);
  const prev = useStore((s) => s.prevForDigest);
  const parcels = useStore((s) => s.parcels);

  // Two appraisals of the whole book. Keyed on the state references — an
  // advance always replaces them — and paid only while this card is mounted,
  // which is only while the popover is open or the Books page is up.
  const model = useMemo(
    () => (game ? buildModel(game, prev, parcels) : null),
    [game, prev, parcels],
  );
  if (!game || !model) return null;

  // Compact keeps the loudest lines and folds the remainder into one honest
  // aggregate, so the popover never grows a scrollbar after a long skip.
  const topRevals = compact ? 3 : 6;
  const capEvents = compact ? 2 : Number.POSITIVE_INFINITY;
  const shownExits = model.exits.slice(0, capEvents);
  const shownEntries = model.entries.slice(0, capEvents);
  const shownRevals = model.revals.slice(0, topRevals);
  const shownValue = [...shownExits, ...shownEntries, ...shownRevals];
  const shownValueSum = shownValue.reduce((a, r) => a + r.amount, 0);
  const valueRestN = (model.exits.length - shownExits.length)
    + (model.entries.length - shownEntries.length)
    + (model.revals.length - shownRevals.length);
  const valueRest = model.valueNet - shownValueSum;

  let cashShown = model.cashRows;
  let cashRestAmt = 0, cashRestN = 0;
  if (compact && model.cashRows.length > 6) {
    const keep = new Set(
      [...model.cashRows].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 6).map((r) => r.key),
    );
    cashShown = model.cashRows.filter((r) => keep.has(r.key));
    const rest = model.cashRows.filter((r) => !keep.has(r.key));
    cashRestAmt = rest.reduce((a, r) => a + r.amount, 0);
    cashRestN = rest.length;
  }

  const cashMax = Math.max(0, ...cashShown.map((r) => Math.abs(r.amount)), Math.abs(cashRestAmt));
  const valueMax = Math.max(0, ...shownValue.map((r) => Math.abs(r.amount)), Math.abs(valueRest));

  const body = (
    <>
      {model.empty && model.dNw === null ? (
        <div className="hint">Nothing to attribute yet — advance a month and the ledger opens.</div>
      ) : (
        <>
          <div className="wf-kicker">Cash · the ledger</div>
          {cashShown.length ? (
            <div className="wf-rows">
              {cashShown.map((r) => (
                <WfRow key={r.key} label={r.label} note={compact ? undefined : r.note} amount={r.amount} max={cashMax} />
              ))}
              {cashRestN > 0 && (
                <WfRow label={`everything else · ${cashRestN} line${cashRestN === 1 ? "" : "s"}`} amount={cashRestAmt} max={cashMax} />
              )}
              <WfTotal label="Cash, net" amount={model.cashNet} />
            </div>
          ) : (
            <div className="hint">No cash moved {model.windowLabel === monthLabel(game.month) ? "this month" : model.windowLabel}.</div>
          )}

          <div className="wf-kicker">Value · the marks</div>
          {!model.hasPrev ? (
            <div className="hint">
              Per-building revaluation compares this month&apos;s marks with the month before, and the prior
              month&apos;s marks left with the last session. Advance a month and this section fills in.
            </div>
          ) : shownValue.length || valueRestN > 0 ? (
            <div className="wf-rows">
              {shownValue.map((r) => (
                <WfRow key={r.key} label={r.label} amount={r.amount} max={valueMax} />
              ))}
              {valueRestN > 0 && (
                <WfRow label={`everything else · ${valueRestN} position${valueRestN === 1 ? "" : "s"}`} amount={valueRest} max={valueMax} />
              )}
              <WfTotal label="Value, net" amount={model.valueNet} />
            </div>
          ) : (
            <div className="hint">The marks sat still — no deed repriced, arrived or left this window.</div>
          )}
        </>
      )}

      {model.dNw !== null && (
        <div className="wf-foot">
          <div className="wf-dnw">
            <span>Net worth · {model.windowLabel}</span>
            <span className={"mono" + (model.dNw < 0 ? " wf-amt-neg" : "")}>{signed(model.dNw)}</span>
          </div>
          {model.resid !== null && Math.abs(model.resid) >= 10_000 && (
            <div className="hint">
              {signed(model.resid)} of that sits below these lines — loan amortisation and payoffs at sale,
              construction basis, note marks, and the liability side of the credit line and deposits.
              The ledger still reconciles to the dollar; this card names the loud movements.
            </div>
          )}
        </div>
      )}
    </>
  );

  if (compact) {
    return (
      <div className="wf wf-compact">
        <div className="wf-compact-head">
          <span className="wf-kicker wf-kicker-title">Net worth, attributed</span>
          <span className="wf-window mono">{model.windowLabel}</span>
        </div>
        {body}
      </div>
    );
  }
  return (
    <section className="page-section wf">
      <div className="page-section-head">The month, attributed · {model.windowLabel}</div>
      <div className="hint">
        Two ledgers, one move. The cash is the statement&apos;s own buckets for the window; the marks are the
        same appraisal the top bar, the lender and the balance sheet read — nothing here is a second opinion.
      </div>
      {body}
    </section>
  );
}
