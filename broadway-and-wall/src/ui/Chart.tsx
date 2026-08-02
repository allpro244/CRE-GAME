// Charts, in plain SVG, with no dependency and no canvas.
//
// A sparkline is a shape. A CHART has a scale, a zero, gridlines you can read
// values off, and a legend — and the difference matters here because the whole
// point of the economy page is that a player can look at supply and demand and
// know what to do. Three primitives cover everything that page needs: a line
// chart with optional reference bands, a grouped bar chart for flows, and a
// horizontal gauge for "where is this relative to normal".

export interface Series { label: string; color: string; pts: number[]; dashed?: boolean }
export interface RefBand { at: number; label?: string; color?: string }

const fmtNum = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : v.toFixed(0));

/** Pick round gridline values that bracket the data. */
function ticks(lo: number, hi: number, want = 4): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / want;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((c) => c >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

export function LineChart({
  series, height = 132, yFmt = fmtNum, bands = [], xLabels, zeroBase = false, split,
}: {
  series: Series[];
  height?: number;
  yFmt?: (v: number) => string;
  bands?: RefBand[];
  xLabels?: [string, string];
  zeroBase?: boolean;
  /** index at which history ends and projection begins */
  split?: number;
}) {
  const n = Math.max(...series.map((s) => s.pts.length), 0);
  if (n < 2) return <div className="hint">Not enough history yet — advance a few quarters.</div>;
  const PAD_L = 52, PAD_R = 10, PAD_T = 10, PAD_B = xLabels ? 20 : 8;
  const W = 480; // real pixels across; uniform scaling keeps text undistorted
  let lo = Infinity, hi = -Infinity;
  for (const s of series) for (const v of s.pts) { if (v < lo) lo = v; if (v > hi) hi = v; }
  for (const b of bands) { if (b.at < lo) lo = b.at; if (b.at > hi) hi = b.at; }
  if (zeroBase) lo = Math.min(lo, 0);
  if (!(hi > lo)) { hi = lo + 1; }
  const pad = (hi - lo) * 0.08;
  lo -= pad; hi += pad;
  const ys = ticks(lo, hi, 4);
  const px = (i: number, len: number) => PAD_L + ((W - PAD_L - PAD_R) * i) / Math.max(1, len - 1);
  const py = (v: number) => PAD_T + (height - PAD_T - PAD_B) * (1 - (v - lo) / (hi - lo));

  return (
    <svg viewBox={`0 0 ${W} ${height}`} style={{ width: "100%", display: "block", overflow: "visible" }}>
      {ys.map((v) => (
        <g key={v}>
          <line x1={PAD_L} x2={W - PAD_R} y1={py(v)} y2={py(v)} stroke="#cfc7b2" strokeWidth={0.8} />
          <text x={PAD_L - 5} y={py(v) + 3.5} textAnchor="end" fontSize={10} fill="#8b8370" style={{ fontFamily: "var(--mono)" }}>{yFmt(v)}</text>
        </g>
      ))}
      {bands.map((b, i) => (
        <g key={"b" + i}>
          <line x1={PAD_L} x2={W - PAD_R} y1={py(b.at)} y2={py(b.at)} stroke={b.color ?? "#a8402e"} strokeWidth={1.1} strokeDasharray="5 4" opacity={0.8} />
          {b.label && <text x={W - PAD_R} y={py(b.at) - 2.5} textAnchor="end" fontSize={10} fill={b.color ?? "#a8402e"}>{b.label}</text>}
        </g>
      ))}
      {split !== undefined && split > 0 && (
        <line x1={px(split, n)} x2={px(split, n)} y1={PAD_T} y2={height - PAD_B} stroke="#8b8370" strokeWidth={1} strokeDasharray="4 4" />
      )}
      {series.map((s) => (
        <polyline
          key={s.label}
          points={s.pts.map((v, i) => `${px(i, s.pts.length)},${py(v)}`).join(" ")}
          fill="none"
          stroke={s.color}
          strokeWidth={1.6}
          strokeDasharray={s.dashed ? "5 3.5" : undefined}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      ))}
      {xLabels && (
        <>
          <text x={PAD_L} y={height - 4} fontSize={10} fill="#8b8370">{xLabels[0]}</text>
          <text x={W - PAD_R} y={height - 4} fontSize={10} fill="#8b8370" textAnchor="end">{xLabels[1]}</text>
        </>
      )}
    </svg>
  );
}

export interface BarGroup { label: string; bars: { v: number; color: string }[] }

/** Grouped bars around a real zero line — for flows, which can go negative. */
export function BarChart({ groups, height = 120, yFmt = fmtNum }: { groups: BarGroup[]; height?: number; yFmt?: (v: number) => string }) {
  if (!groups.length) return <div className="hint">Nothing to show yet.</div>;
  const PAD_L = 52, PAD_R = 8, PAD_T = 8, PAD_B = 20;
  const W = 480;
  let lo = 0, hi = 0;
  for (const g of groups) for (const b of g.bars) { if (b.v < lo) lo = b.v; if (b.v > hi) hi = b.v; }
  if (hi === lo) hi = lo + 1;
  const pad = (hi - lo) * 0.1;
  hi += pad; lo -= lo < 0 ? pad : 0;
  const ys = ticks(lo, hi, 3);
  const py = (v: number) => PAD_T + (height - PAD_T - PAD_B) * (1 - (v - lo) / (hi - lo));
  const gw = (W - PAD_L - PAD_R) / groups.length;
  const nb = Math.max(1, groups[0].bars.length);
  const bw = (gw * 0.72) / nb;

  return (
    <svg viewBox={`0 0 ${W} ${height}`} style={{ width: "100%", display: "block", overflow: "visible" }}>
      {ys.map((v) => (
        <g key={v}>
          <line x1={PAD_L} x2={W - PAD_R} y1={py(v)} y2={py(v)} stroke={v === 0 ? "#9b9384" : "#cfc7b2"} strokeWidth={v === 0 ? 1.2 : 0.8} />
          <text x={PAD_L - 5} y={py(v) + 3.5} textAnchor="end" fontSize={10} fill="#8b8370" style={{ fontFamily: "var(--mono)" }}>{yFmt(v)}</text>
        </g>
      ))}
      {groups.map((g, gi) => (
        <g key={g.label + gi}>
          {g.bars.map((b, bi) => {
            const x = PAD_L + gw * gi + gw * 0.14 + bw * bi;
            const y0 = py(0), y1 = py(b.v);
            return <rect key={bi} x={x} y={Math.min(y0, y1)} width={bw * 0.86} height={Math.max(0.6, Math.abs(y1 - y0))} fill={b.color} />;
          })}
          <text x={PAD_L + gw * gi + gw / 2} y={height - 4} fontSize={10} fill="#8b8370" textAnchor="middle">{g.label}</text>
        </g>
      ))}
    </svg>
  );
}

/**
 * Where a number sits against its normal range, as a bar with a marker. The
 * fastest way to answer "is this high or low" without reading an axis.
 */
export function Gauge({ value, natural, lo, hi, fmt }: { value: number; natural: number; lo: number; hi: number; fmt: (v: number) => string }) {
  const at = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100)).toFixed(1)}%`;
  const tight = value < natural;
  return (
    <div className="gauge">
      <div className="gauge-track">
        <div className="gauge-fill" style={{ width: at(value), background: tight ? "linear-gradient(90deg,#4a7d5a,#6ea87c)" : "linear-gradient(90deg,#b58a3a,#b8563a)" }} />
        <div className="gauge-natural" style={{ left: at(natural) }} title={`natural rate ${fmt(natural)}`} />
      </div>
      <div className="gauge-legend">
        <span className="mono">{fmt(value)}</span>
        <span className="dim">natural {fmt(natural)}</span>
      </div>
    </div>
  );
}
