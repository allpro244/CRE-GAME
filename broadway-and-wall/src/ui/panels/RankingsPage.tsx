import { useMemo, useState } from "react";
import { useStore } from "@/state/store";
import { cityRankings, PEER_SOURCES, type RankRow } from "@/engine/peers";

/**
 * THE LEAGUE TABLE. Your town against thirty-two real US cities of its era —
 * boomtowns, steady regional centres and the Rust Belt — on size, growth,
 * jobs, pay and rent. See engine/peers.ts for where every number comes from
 * and how the cities are carried past the end of the record.
 */
type Key = "pop" | "growth10" | "unemp" | "pay" | "rent2br" | "afford";
const COLS: { key: Key; label: string; title: string; better: "high" | "low" }[] = [
  { key: "pop", label: "Population", title: "People living in the city", better: "high" },
  { key: "growth10", label: "Growth, 10 yr", title: "Population growth per year over the last ten years", better: "high" },
  { key: "unemp", label: "Unemployment", title: "Share of the labour force out of work", better: "low" },
  { key: "pay", label: "Average pay", title: "Average annual pay per job, in 2000 dollars", better: "high" },
  { key: "rent2br", label: "Two-bed rent", title: "Monthly rent for a two-bedroom flat, in 2000 dollars", better: "low" },
  { key: "afford", label: "Rent / pay", title: "A year of two-bed rent as a share of a year's average pay", better: "low" },
];

const val = (r: RankRow, k: Key): number | null =>
  k === "afford" ? (r.pay > 0 ? (r.rent2br * 12) / r.pay : null) : (r[k] as number | null);

function fmt(k: Key, v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (k === "pop") return v.toLocaleString("en-US");
  if (k === "growth10") return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
  if (k === "unemp") return `${v.toFixed(1)}%`;
  if (k === "pay") return `$${Math.round(v).toLocaleString("en-US")}`;
  if (k === "rent2br") return `$${Math.round(v).toLocaleString("en-US")}`;
  return `${(v * 100).toFixed(0)}%`;
}

export function RankingsPage() {
  const game = useStore((s) => s.game);
  const manifest = useStore((s) => s.manifest);
  const [sortBy, setSortBy] = useState<Key>("pop");
  const town = manifest?.city ?? "Your town";
  const table = useMemo(() => (game ? cityRankings(game, town) : null), [game, town]);
  if (!game || !table) return null;
  const col = COLS.find((c) => c.key === sortBy)!;
  const sorted = [...table.rows].sort((a, b) => {
    const va = val(a, sortBy), vb = val(b, sortBy);
    if (va === null) return 1;
    if (vb === null) return -1;
    return col.better === "high" ? vb - va : va - vb;
  });
  const rankOf = (k: Key) => {
    const c = COLS.find((x) => x.key === k)!;
    const xs = table.rows.filter((r) => val(r, k) !== null)
      .sort((a, b) => (c.better === "high" ? val(b, k)! - val(a, k)! : val(a, k)! - val(b, k)!));
    const i = xs.findIndex((r) => r.you);
    return i >= 0 ? `${i + 1} of ${xs.length}` : "—";
  };
  const past = table.year > table.recordEnds;
  return (
    <div>
      <div className="page-section">Where {town} ranks, {table.year}</div>
      <div className="hint">
        Against 32 real US cities that ranged from about 18,000 to 230,000 people in 2000.{" "}
        {past
          ? `The real record ends in ${table.recordEnds}; after that each city carries its own recent growth forward, fading toward the nation's over a few decades. Rows marked * are projected.`
          : `Population is the Census record for ${table.year}. Unemployment, pay and rent are each city's real gap to the US that year, laid on this game's national economy.`}{" "}Pay and rent are in 2000 dollars.
      </div>
      <div className="seg" role="radiogroup" aria-label="Rank by" style={{ margin: "10px 0" }}>
        {COLS.map((c) => (
          <button key={c.key} role="radio" aria-checked={sortBy === c.key} title={c.title}
            className={"seg-btn" + (sortBy === c.key ? " on" : "")} onClick={() => setSortBy(c.key)}>
            {c.label} <span className="dim">#{rankOf(c.key).split(" ")[0]}</span>
          </button>
        ))}
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th className="num">#</th><th>City</th>
            {COLS.map((c) => (
              <th key={c.key} className="num" title={c.title} style={{ cursor: "pointer", fontWeight: sortBy === c.key ? 700 : undefined }}
                onClick={() => setSortBy(c.key)}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={r.name + r.state} style={r.you ? { background: "var(--accent-soft, rgba(196,150,40,0.16))", fontWeight: 700 } : undefined}>
              <td className="num">{val(r, sortBy) === null ? "—" : i + 1}</td>
              <td>{r.you ? `${r.name} (you)` : `${r.name}, ${r.state}`}{r.projected ? " *" : ""}</td>
              {COLS.map((c) => <td key={c.key} className="num">{fmt(c.key, val(r, c.key))}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <details style={{ marginTop: 10 }}>
        <summary className="dim">Sources</summary>
        <ul className="dim" style={{ fontSize: 12 }}>
          {PEER_SOURCES.map((x) => <li key={x.series}>{x.series}: {x.url}</li>)}
          <li>Unemployment and pay are the city's county; rent is its HUD Fair Market Rent area. A suburb such as Gilbert or Frisco is a small part of its county, so those two columns describe the county around it.</li>
        </ul>
      </details>
    </div>
  );
}
