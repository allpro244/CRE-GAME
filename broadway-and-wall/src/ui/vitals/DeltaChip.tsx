// One month's movement, always with an explicit sign — never color alone,
// because color is the one channel a tenth of players cannot read.
import "./vitals.css";

export default function DeltaChip({
  value, fmt, goodWhenUp = true, title, epsilon = 0,
}: {
  value: number;
  /** Formats the magnitude only — the chip owns the sign. */
  fmt: (n: number) => string;
  /** Rate and vacancy chips flip this: up is the bad direction. */
  goodWhenUp?: boolean;
  title?: string;
  /** Movements at or under this read as flat — keeps noise off the bar. */
  epsilon?: number;
}) {
  if (!Number.isFinite(value)) return null;
  const flat = Math.abs(value) <= epsilon;
  const up = value > 0;
  const cls = flat
    ? "delta-chip delta-flat"
    : (up === goodWhenUp ? "delta-chip delta-good" : "delta-chip delta-bad");
  const sign = flat ? "·" : up ? "+" : "−";
  return (
    <span className={cls} title={title}>
      <span className="delta-sign">{sign}</span>
      {flat ? "flat" : fmt(Math.abs(value))}
    </span>
  );
}
