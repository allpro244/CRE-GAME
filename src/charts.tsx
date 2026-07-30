// Minimal SVG charts, no dependencies.

export interface Series { name: string; color: string; data: number[]; }
// index spans to shade behind the lines — recessions, credit crunches
export interface Band { from: number; to: number; color?: string; }

export function LineChart({ series, labels, height = 140, yFmt, bands }: {
  series: Series[]; labels?: string[]; height?: number; yFmt?: (v: number) => string; bands?: Band[];
}) {
  const W = 560, H = height, PL = 46, PR = 8, PT = 8, PB = 18;
  const all = series.flatMap(s => s.data).filter(v => isFinite(v));
  if (all.length === 0) return <div className="faint" style={{ fontSize: 12 }}>No data yet.</div>;
  let min = Math.min(...all), max = Math.max(...all);
  if (max - min < 1e-9) { max += 1; min -= 1; }
  const pad = (max - min) * 0.08; min -= pad; max += pad;
  const n = Math.max(...series.map(s => s.data.length));
  const x = (i: number) => PL + ((W - PL - PR) * i) / Math.max(1, n - 1);
  const y = (v: number) => PT + (H - PT - PB) * (1 - (v - min) / (max - min));
  const fmt = yFmt ?? ((v: number) => v.toFixed(1));
  const ticks = [min + pad, (min + max) / 2, max - pad];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {/* the bad quarters shade the background, FRED-style — the lines then explain themselves */}
      {bands?.map((b, i) => b.to > b.from ? (
        <rect key={'bd' + i} x={x(b.from)} y={PT} width={Math.max(1, x(Math.min(b.to, n - 1)) - x(b.from))} height={H - PT - PB}
          fill={b.color ?? '#8a4a42'} opacity={0.13} />
      ) : null)}
      {ticks.map((tv, i) => (
        <g key={i}>
          <line x1={PL} x2={W - PR} y1={y(tv)} y2={y(tv)} stroke="var(--line2)" strokeWidth={1} />
          <text x={PL - 6} y={y(tv) + 3.5} fontSize={9.5} fill="var(--faint)" textAnchor="end" className="num">{fmt(tv)}</text>
        </g>
      ))}
      {series.map(s => (
        <polyline key={s.name} fill="none" stroke={s.color} strokeWidth={1.8}
          points={s.data.map((v, i) => `${x(i)},${y(v)}`).join(' ')} strokeLinejoin="round" />
      ))}
      {labels && labels.length > 1 && (
        <>
          <text x={PL} y={H - 4} fontSize={9.5} fill="var(--faint)">{labels[0]}</text>
          <text x={W - PR} y={H - 4} fontSize={9.5} fill="var(--faint)" textAnchor="end">{labels[labels.length - 1]}</text>
        </>
      )}
    </svg>
  );
}

export function Bars({ data, height = 110, color = 'var(--green)', negColor = 'var(--red)', yFmt }: {
  data: number[]; height?: number; color?: string; negColor?: string; yFmt?: (v: number) => string;
}) {
  const W = 560, H = height, PL = 46, PR = 8, PT = 6, PB = 6;
  if (data.length === 0) return <div className="faint" style={{ fontSize: 12 }}>No data yet.</div>;
  const maxAbs = Math.max(1, ...data.map(v => Math.abs(v)));
  const zero = PT + (H - PT - PB) / 2;
  const scale = (H - PT - PB) / 2 / maxAbs;
  const bw = Math.min(26, (W - PL - PR) / data.length - 3);
  const fmt = yFmt ?? ((v: number) => v.toFixed(0));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <line x1={PL} x2={W - PR} y1={zero} y2={zero} stroke="var(--line)" strokeWidth={1} />
      <text x={PL - 6} y={PT + 8} fontSize={9.5} fill="var(--faint)" textAnchor="end" className="num">{fmt(maxAbs)}</text>
      <text x={PL - 6} y={H - PB} fontSize={9.5} fill="var(--faint)" textAnchor="end" className="num">{fmt(-maxAbs)}</text>
      {data.map((v, i) => {
        const h = Math.abs(v) * scale;
        const xx = PL + i * ((W - PL - PR) / data.length) + 2;
        return <rect key={i} x={xx} width={bw} y={v >= 0 ? zero - h : zero} height={Math.max(1, h)}
          fill={v >= 0 ? color : negColor} rx={1.5} />;
      })}
    </svg>
  );
}
