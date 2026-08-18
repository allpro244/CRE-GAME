// Chip-scale sparkline. No axes, no labels — it answers one question, "which
// way has this been going", next to the number that says where it is now.
// Stroke follows currentColor so the surrounding text owns the palette.
import "./vitals.css";

export default function Spark({
  values, width = 64, height = 18, strokeWidth = 1.5, title,
}: {
  values: readonly number[];
  width?: number;
  height?: number;
  strokeWidth?: number;
  title?: string;
}) {
  const n = values.length;
  if (n < 2) return null;
  let lo = Infinity, hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) return null;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  // A flat series draws a midline rather than dividing by zero.
  const span = hi - lo || 1;
  const pad = strokeWidth;
  const pts = values
    .map((v, i) => {
      const x = pad + (i / (n - 1)) * (width - pad * 2);
      const y = pad + (1 - (v - lo) / span) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      className="spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={title ?? "trend"}
    >
      {title ? <title>{title}</title> : null}
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
