/**
 * A FIGURE IS A NUMBER YOU CAN OPEN (PLAN R3). It prints with a dotted
 * underline; a click opens its Breakdown beside it. One open at a time; Esc
 * or a click elsewhere closes it.
 */
import { useEffect, useRef } from "react";
import { useStore } from "@/state/store";
import { usd, sf as sfFmt } from "@/ui/format";
import { useNext } from "./nextStore";
import { DRILLS, type DrillArgs, type DrillKey } from "./drills";

export type FigFmt = "usd" | "pct" | "pctv" | "psf" | "x" | "sf" | "n" | "bp";

export function fmtFig(v: number | null | undefined, f: FigFmt): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  switch (f) {
    case "usd": return usd(v);
    case "pct": return (v * 100).toFixed(1) + "%";
    case "pctv": return v.toFixed(2) + "%";
    case "psf": return "$" + v.toFixed(2);
    case "x": return v.toFixed(2) + "×";
    case "sf": return sfFmt(v);
    case "bp": return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(Math.round(v)) + "bp";
    default: return Math.round(v).toLocaleString();
  }
}

let seq = 0;

export function Figure({ value, fmt, drill, args, tone, text }: {
  value: number | null; fmt: FigFmt; drill?: DrillKey; args?: DrillArgs; tone?: "pos" | "neg"; text?: string;
}) {
  const id = useRef("fig" + ++seq).current;
  const open = useNext((s) => s.drill?.id === id);
  const shown = text ?? fmtFig(value, fmt);
  const cls = "nx-fig" + (tone ? " nx-" + tone : "") + (drill ? " nx-drillable" : "") + (open ? " nx-open" : "");
  if (!drill) return <span className={cls}>{shown}</span>;
  return (
    <button
      type="button"
      className={cls}
      data-drill={drill}
      onClick={(e) => {
        e.stopPropagation();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        useNext.getState().setDrill(open ? null : { id, key: drill, args, x: r.left, y: r.bottom });
      }}
    >
      {shown}
    </button>
  );
}

/** A small line of a series, no axes: the shape, not the scale. */
export function Spark({ pts, w = 64, h = 16 }: { pts: number[]; w?: number; h?: number }) {
  const xs = pts.filter(Number.isFinite);
  if (xs.length < 2) return null;
  const lo = Math.min(...xs), hi = Math.max(...xs);
  const span = hi - lo || 1;
  const d = xs.map((v, i) => `${i ? "L" : "M"}${((i / (xs.length - 1)) * w).toFixed(1)},${(h - ((v - lo) / span) * (h - 2) - 1).toFixed(1)}`).join("");
  const up = xs[xs.length - 1] >= xs[0];
  return (
    <svg className={"nx-spark " + (up ? "nx-up" : "nx-down")} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={d} fill="none" strokeWidth="1.25" />
    </svg>
  );
}

/** The one open breakdown, drawn at its figure. */
export function DrillLayer() {
  const drill = useNext((s) => s.drill);
  const game = useStore((s) => s.game);
  const parcels = useStore((s) => s.parcels);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!drill) return;
    const down = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current?.contains(t) || t.closest?.(".nx-drillable")) return;
      useNext.getState().setDrill(null);
    };
    window.addEventListener("mousedown", down);
    return () => window.removeEventListener("mousedown", down);
  }, [drill]);
  if (!drill || !game || !parcels) return null;
  const fn = DRILLS[drill.key as DrillKey];
  if (!fn) return null;
  const d = fn(game, parcels, (drill.args ?? {}) as DrillArgs);
  const W = 340;
  const left = Math.max(8, Math.min(drill.x, window.innerWidth - W - 8));
  const top = Math.min(drill.y + 6, window.innerHeight - 120);
  return (
    <div className="nx-breakdown" ref={ref} style={{ left, top, width: W, maxHeight: window.innerHeight - top - 12 }} role="dialog" aria-label={d.title}>
      <div className="nx-bd-head">
        <span className="nx-bd-title">{d.title}</span>
        <span className="nx-bd-total mono">{d.total}</span>
      </div>
      {d.series && d.series.pts.length > 1 && <div className="nx-bd-spark"><Spark pts={d.series.pts} w={W - 24} h={36} /></div>}
      <table className="nx-bd-rows">
        <tbody>
          {d.rows.map((r, i) => (
            <tr key={i} className={r.strong ? "nx-strong" : undefined}>
              <td>{r.label}</td>
              <td className={"mono" + (r.tone ? " nx-" + r.tone : "")}>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.formula && <div className="nx-bd-formula mono">{d.formula}</div>}
      {d.link && (
        <button type="button" className="nx-link" onClick={() => { useNext.getState().setDrill(null); d.link!.go(); }}>
          {d.link.label} ›
        </button>
      )}
    </div>
  );
}
