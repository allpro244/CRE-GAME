/**
 * THE CAPITAL PLAN DESK (owner, 2026-10-22: "in the web version you could edit
 * the capital plan of the building, which affects its condition and demand").
 * The plan and the programmes were on the classic Management desk, folded
 * under the Rent roll's "Desk ▾" where nobody found them. Here they are on
 * the Money tab: each plan's spend, the building ten years on under it, and
 * what that condition is worth in rent, tenant pull and value — all from the
 * engine (engine/capplan.ts runs the tick's own step forward).
 */
import { useMemo } from "react";
import { useStore } from "@/state/store";
import type { GameState, Holding } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import { monthLabel, START_YEAR } from "@/engine/types";
import { ownedHoldingValue, resolveRec } from "@/engine/value";
import { capPaths, capRead, programRows, type CapRead } from "@/engine/capplan";
import { usd } from "@/ui/format";
import { fmtFig } from "./Figure";
import { VerbButton } from "./Drawer";

const YEARS = 10;
const cond = (idx: number) => Math.round(idx * 100);
const GRADE: Record<string, string> = { good: "good", standard: "std", worn: "worn", obsolete: "obs" };

function Cond({ r, was }: { r: { condIdx: number; grade: string }; was?: number }) {
  const d = was === undefined ? 0 : cond(r.condIdx) - cond(was);
  return (
    <span className={"mono" + (d < 0 ? " nx-neg" : d > 0 ? " nx-pos" : "")}>
      {cond(r.condIdx)} <span className="nx-dim">{GRADE[r.grade] ?? r.grade}</span>
    </span>
  );
}

function Delta({ v, base, fmt }: { v: number; base: number; fmt: "psf" | "usd" | "x" }) {
  const rel = base ? v / base - 1 : 0;
  const tone = Math.abs(rel) < 0.0005 ? "" : rel < 0 ? " nx-neg" : " nx-pos";
  return (
    <span className="mono">
      {fmt === "usd" ? usd(v) : fmtFig(v, fmt)}
      <span className={"nx-cap-d" + tone}>{Math.abs(rel) < 0.0005 ? "" : (rel > 0 ? "+" : "") + fmtFig(rel, "pct")}</span>
    </span>
  );
}

/** A change of stabilised value (assetValue), in dollars and per cent: the file's Value strip is the in-place appraisal, so only the difference is shown here. */
function Gain({ v, base }: { v: number; base: number }) {
  const d = v - base;
  const rel = base ? d / base : 0;
  const tone = Math.abs(rel) < 0.0005 ? "" : d < 0 ? " nx-neg" : " nx-pos";
  return (
    <span className={"mono" + tone}>
      {Math.abs(rel) < 0.0005 ? "—" : (d > 0 ? "+" : "−") + usd(Math.abs(d))}
      <span className={"nx-cap-d" + tone}>{Math.abs(rel) < 0.0005 ? "" : (rel > 0 ? "+" : "") + fmtFig(rel, "pct")}</span>
    </span>
  );
}

export function CapitalDesk({ game, parcels, bbl, h }: { game: GameState; parcels: ParcelTable; bbl: string; h: Holding }) {
  const rec = resolveRec(parcels, game, bbl)!;
  const { gav, now, paths, progs } = useMemo(() => {
    const gav = ownedHoldingValue(game, parcels, h);
    const idx = h.condIdx ?? 0.6;
    return { gav, now: capRead(game, rec, idx), paths: capPaths(game, rec, h, gav, YEARS), progs: programRows(game, rec, h, gav, YEARS) };
  }, [game, parcels, h, rec]);
  // tenant pull only where the engine prices it (bands.ts returns 1 for a class it has no bands for)
  const pull = [now, ...paths.map((p) => p.end), ...progs.map((p) => p.end)].some((r) => Math.abs(r.draw - 1) > 1e-6);
  const plan = h.plan ?? 1;
  const active = paths.find((p) => p.plan === plan) ?? paths[1];
  const yr0 = START_YEAR + Math.floor(game.month / 12);
  const row = (label: string, r: CapRead, extra: React.ReactNode, on = false, onClick?: () => void, key?: string) => (
    <tr key={key ?? label} className={on ? "on" : undefined} onClick={onClick} style={onClick ? { cursor: "pointer" } : undefined}>
      <td>{label}</td>
      {extra}
      <td className="num"><Cond r={r} was={now.condIdx} /></td>
      <td className="num"><Delta v={r.rentPsf} base={now.rentPsf} fmt="psf" /></td>
      {pull && <td className="num"><Delta v={r.draw} base={now.draw} fmt="x" /></td>}
      <td className="num"><Gain v={r.value} base={now.value} /></td>
    </tr>
  );
  return (
    <div className="nx-box nx-cap">
      <div className="nx-box-head nx-cap-head">
        <span>Capital plan</span>
        <span className="nx-seg" role="group" aria-label="Capital plan">
          {paths.map((p) => (
            <button key={p.plan} type="button" className={"nx-btn nx-sm" + (p.plan === plan ? " nx-on" : "")}
              aria-pressed={p.plan === plan} onClick={() => useStore.getState().ops(bbl, { plan: p.plan })}>{p.label}</button>
          ))}
        </span>
      </div>
      <table className="nx-table nx-pickable nx-cap-plans">
        <thead><tr>
          <th>In {YEARS}y</th><th className="num">$ / yr</th><th className="num">{YEARS}y spend</th>
          <th className="num">Condition</th><th className="num">Rent $/sf</th>{pull && <th className="num" title="Draw vs class">Pull</th>}<th className="num" title="Stabilised value change">Δ value</th>
        </tr></thead>
        <tbody>
          <tr className="nx-cap-now">
            <td>Today</td><td className="num mono nx-dim">—</td><td className="num mono nx-dim">—</td>
            <td className="num"><Cond r={now} /></td>
            <td className="num mono">{fmtFig(now.rentPsf, "psf")}</td>
            {pull && <td className="num mono">{fmtFig(now.draw, "x")}</td>}
            <td className="num mono">—</td>
          </tr>
          {paths.map((p) => row(p.label, p.end, (
            <>
              <td className="num mono">{usd(p.years[0]?.spend ?? 0)}</td>
              <td className="num mono">{usd(p.total)}</td>
            </>
          ), p.plan === plan, () => useStore.getState().ops(bbl, { plan: p.plan }), "plan" + p.plan))}
        </tbody>
      </table>
      <table className="nx-table nx-cap-years">
        <thead><tr><th>{active.label}</th>{active.years.map((y) => <th key={y.yr} className="num">{yr0 + y.yr}</th>)}</tr></thead>
        <tbody>
          <tr><td>Spend</td>{active.years.map((y) => <td key={y.yr} className="num mono">{y.spend ? usd(y.spend) : "—"}</td>)}</tr>
          <tr><td>Condition</td>{active.years.map((y) => (
            <td key={y.yr} className="num"><span className="nx-cap-bar" style={{ ["--v" as string]: String(cond(y.condIdx)) }}><span className="mono">{cond(y.condIdx)}</span></span></td>
          ))}</tr>
        </tbody>
      </table>
      <table className="nx-table nx-cap-progs">
        <thead><tr>
          <th>Programme</th><th className="num">Cost</th><th className="num">Months</th><th className="num">Lift</th>
          <th className="num">Condition</th><th className="num">Rent $/sf</th>{pull && <th className="num" title="Draw vs class">Pull</th>}<th className="num" title="Stabilised value change">Δ value</th><th />
        </tr></thead>
        <tbody>
          {progs.map((p) => {
            const due = p.dueM !== null && p.dueM > game.month;
            const busy = !!h.program;
            const v = { label: p.running ? "Running" : due ? `Due ${monthLabel(p.dueM!)}` : "Start", primary: false,
              disabled: p.running ? "Underway" : due ? "Done recently" : busy ? "Another is running" : h.renovatingUntilM !== undefined ? "Renovating" : undefined,
              run: () => useStore.getState().program(bbl, p.id) };
            return (
              <tr key={p.id}>
                <td>{p.label}</td>
                <td className="num mono">{usd(p.cost)}</td>
                <td className="num mono">{p.months}</td>
                <td className="num mono nx-pos">+{cond(p.lift)}</td>
                <td className="num"><Cond r={p.end} was={now.condIdx} /></td>
                <td className="num"><Delta v={p.end.rentPsf} base={now.rentPsf} fmt="psf" /></td>
                {pull && <td className="num"><Delta v={p.end.draw} base={now.draw} fmt="x" /></td>}
                <td className="num"><Gain v={p.end.value} base={now.value} /></td>
                <td className="nx-dt-act"><VerbButton small v={v} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="nx-cap-foot nx-dim mono">{`${YEARS}y · market today · plan on ${usd(gav)}`}</div>
    </div>
  );
}
