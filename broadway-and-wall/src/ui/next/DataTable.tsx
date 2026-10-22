/**
 * THE DENSE TABLE (PLAN R4): 30px rows, mono numerals, every column sorts,
 * sticky header, a column picker, row actions on the row. Long tables draw
 * only the rows in view (a fixed row height makes the window exact).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fmtFig, type FigFmt } from "./Figure";

export interface Col<R> {
  id: string;
  label: string;
  /** The sort key, and the printed value unless `cell` is given. */
  get: (r: R) => number | string | null | undefined;
  fmt?: FigFmt;
  cell?: (r: R) => ReactNode;
  /** Numbers right-aligned (default when `fmt` is set). */
  num?: boolean;
  /** Off until picked in the column menu. */
  hidden?: boolean;
  tone?: (r: R) => "pos" | "neg" | undefined;
  width?: number;
}

const ROW = 30;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* blocked */ } };

export function DataTable<R>({ id, cols, rows, rowKey, onRow, actions, initialSort, empty = "None", maxHeight, selected }: {
  id: string;
  cols: Col<R>[];
  rows: R[];
  rowKey: (r: R) => string;
  onRow?: (r: R) => void;
  actions?: (r: R) => ReactNode;
  initialSort?: { col: string; dir: 1 | -1 };
  empty?: string;
  /** Scroll inside the table past this height (px); default grows with the page. */
  maxHeight?: number;
  selected?: string | null;
}) {
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 } | null>(() => {
    try { return JSON.parse(read(`bw:tbl:${id}:sort`) ?? "null") ?? initialSort ?? null; } catch { return initialSort ?? null; }
  });
  const [shown, setShown] = useState<Set<string>>(() => {
    try {
      const v = JSON.parse(read(`bw:tbl:${id}:cols`) ?? "null");
      if (Array.isArray(v)) return new Set(v);
    } catch { /* bad json */ }
    return new Set(cols.filter((c) => !c.hidden).map((c) => c.id));
  });
  const [menu, setMenu] = useState(false);
  const visible = cols.filter((c) => shown.has(c.id));
  const sorted = useMemo(() => {
    const c = sort && cols.find((x) => x.id === sort.col);
    if (!c || !sort) return rows;
    const k = (r: R) => c.get(r);
    return rows.slice().sort((a, b) => {
      const x = k(a), y = k(b);
      if (x === y) return 0;
      if (x === null || x === undefined || (typeof x === "number" && !Number.isFinite(x))) return 1;
      if (y === null || y === undefined || (typeof y === "number" && !Number.isFinite(y))) return -1;
      return (x < y ? -1 : 1) * sort.dir;
    });
  }, [rows, sort, cols]);
  const clickHead = (c: Col<R>) => {
    const next = sort?.col === c.id ? { col: c.id, dir: (sort.dir * -1) as 1 | -1 } : { col: c.id, dir: (c.fmt || c.num ? -1 : 1) as 1 | -1 };
    setSort(next);
    write(`bw:tbl:${id}:sort`, JSON.stringify(next));
  };
  const toggleCol = (cid: string) => {
    const s = new Set(shown);
    if (s.has(cid)) s.delete(cid); else s.add(cid);
    setShown(s);
    write(`bw:tbl:${id}:cols`, JSON.stringify([...s]));
  };

  // windowing: past 120 rows, draw what is in view plus a margin
  const wrap = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, h: 900 });
  const big = sorted.length > 120;
  useEffect(() => {
    if (!big) return;
    const el = wrap.current;
    const sc = maxHeight ? el : el?.closest(".nx-dr-body") as HTMLElement | null;
    if (!el || !sc) return;
    const on = () => {
      const off = maxHeight ? 0 : el.getBoundingClientRect().top - sc.getBoundingClientRect().top;
      setView({ top: Math.max(0, (maxHeight ? sc.scrollTop : -off)), h: sc.clientHeight });
    };
    on();
    sc.addEventListener("scroll", on, { passive: true });
    return () => sc.removeEventListener("scroll", on);
  }, [big, maxHeight]);
  const first = big ? Math.max(0, Math.floor(view.top / ROW) - 20) : 0;
  const last = big ? Math.min(sorted.length, Math.ceil((view.top + view.h) / ROW) + 20) : sorted.length;
  const span = visible.length + (actions ? 1 : 0);

  return (
    <div className="nx-dt" ref={wrap} style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}>
      <table className="nx-table nx-dt-table">
        <thead>
          <tr>
            {visible.map((c) => (
              <th key={c.id} className={(c.fmt || c.num ? "num " : "") + "nx-sortable" + (sort?.col === c.id ? " on" : "")} style={c.width ? { width: c.width } : undefined} onClick={() => clickHead(c)}>
                {c.label}{sort?.col === c.id ? (sort.dir > 0 ? " ▲" : " ▼") : ""}
              </th>
            ))}
            <th className="nx-dt-cols">
              <button type="button" className="nx-dt-pick" onClick={() => setMenu((m) => !m)} aria-label="Columns">⋮</button>
              {menu && (
                <div className="nx-dt-menu" onMouseLeave={() => setMenu(false)}>
                  {cols.map((c) => (
                    <label key={c.id}><input type="checkbox" checked={shown.has(c.id)} onChange={() => toggleCol(c.id)} /> {c.label}</label>
                  ))}
                </div>
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && <tr><td colSpan={span + 1} className="nx-dim">{empty}</td></tr>}
          {first > 0 && <tr style={{ height: first * ROW }}><td colSpan={span + 1} /></tr>}
          {sorted.slice(first, last).map((r) => {
            const k = rowKey(r);
            return (
              <tr key={k} className={(onRow ? "nx-click" : "") + (selected === k ? " on" : "")} onClick={onRow ? () => onRow(r) : undefined}>
                {visible.map((c) => {
                  const v = c.get(r);
                  const t = c.tone?.(r);
                  return (
                    <td key={c.id} className={(c.fmt || c.num ? "num mono" : "") + (t ? " nx-" + t : "")}>
                      {c.cell ? c.cell(r) : c.fmt && typeof v === "number" ? fmtFig(v, c.fmt) : v ?? "—"}
                    </td>
                  );
                })}
                <td className="nx-dt-act" onClick={(e) => e.stopPropagation()}>{actions?.(r)}</td>
              </tr>
            );
          })}
          {last < sorted.length && <tr style={{ height: (sorted.length - last) * ROW }}><td colSpan={span + 1} /></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** One-tap filters above a table. */
export function Chips<T extends string>({ chips, on, set }: { chips: { id: T; label: string; n?: number }[]; on: T[]; set: (v: T[]) => void }) {
  return (
    <div className="nx-chips">
      {chips.map((c) => {
        const lit = on.includes(c.id);
        return (
          <button key={c.id} type="button" className={"nx-chipbtn" + (lit ? " on" : "")} onClick={() => set(lit ? on.filter((x) => x !== c.id) : [...on, c.id])}>
            {c.label}{c.n !== undefined && <span className="mono"> {c.n}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** A row of figures across the top of a place. */
export function StatStrip({ children }: { children: ReactNode }) {
  return <div className="nx-strip">{children}</div>;
}
export function Stat({ label, children }: { label: string; children: ReactNode }) {
  return <div className="nx-stat"><div className="nx-stat-label">{label}</div><div className="nx-stat-value">{children}</div></div>;
}
