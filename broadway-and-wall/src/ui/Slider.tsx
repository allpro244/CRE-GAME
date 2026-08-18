// A labelled range control. Groundwork ran on these: you set the dial and the
// consequence updates under your hand, instead of picking from three canned
// buttons. Every continuous decision in the game should be one of these.
import { useId, useState } from "react";
import { formatUsdExact, parsePriceInput } from "@/ui/priceBounds";

export { widePriceBounds, counterPriceBounds } from "@/ui/priceBounds";

export default function Slider({
  label, value, min, max, step = 1, onChange, format, hint, marks, disabled, editable,
  typedMin, typedMax,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  hint?: string;
  marks?: { at: number; label: string }[];
  disabled?: boolean;
  /** Show a number field; use "price" for $ / comma / 2.75M typing. */
  editable?: boolean | "price";
  /** Type-in floor/ceiling — wider than the track so a mouse stays useful. */
  typedMin?: number;
  typedMax?: number;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const valueText = format ? format(value) : String(value);
  const lo = typedMin ?? min;
  const hi = typedMax ?? max;
  const trackValue = Math.max(min, Math.min(max, value));
  const pct = max > min ? ((trackValue - min) / (max - min)) * 100 : 0;
  const commit = (raw: number, floor = min, ceil = max) => {
    if (!Number.isFinite(raw)) return;
    onChange(Math.round(Math.max(floor, Math.min(ceil, raw))));
  };
  const [draft, setDraft] = useState<string | null>(null);
  const priceShown = draft ?? formatUsdExact(value);
  return (
    <div className={"slider" + (disabled ? " slider-off" : "")}>
      <div className="slider-head">
        <span className="slider-label" id={labelId}>{label}</span>
        {editable ? (
          <input
            type={editable === "price" ? "text" : "number"}
            className="slider-value mono"
            value={editable === "price" ? priceShown : value}
            inputMode={editable === "price" ? "decimal" : undefined}
            min={editable === "price" ? undefined : min}
            max={editable === "price" ? undefined : max}
            step={editable === "price" ? undefined : step}
            disabled={disabled}
            aria-labelledby={labelId}
            onFocus={() => {
              if (editable === "price") setDraft(formatUsdExact(value));
            }}
            onChange={(e) => {
              if (editable === "price") {
                setDraft(e.target.value);
                const raw = parsePriceInput(e.target.value);
                if (Number.isFinite(raw)) commit(raw, lo, hi);
                return;
              }
              commit(parseFloat(e.target.value));
            }}
            onBlur={() => {
              if (editable === "price") {
                const raw = parsePriceInput(draft ?? "");
                if (Number.isFinite(raw)) commit(raw, lo, hi);
                setDraft(null);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        ) : (
          <span className="slider-value mono">{valueText}</span>
        )}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={trackValue}
        disabled={disabled}
        aria-labelledby={labelId}
        aria-valuetext={valueText}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ "--fill": `${pct}%` } as React.CSSProperties}
      />
      {marks && (
        <div className="slider-marks">
          {marks.filter((m) => m.at >= min && m.at <= max).map((m) => (
            <button
              key={m.at}
              className={"slider-mark" + (Math.abs(m.at - value) < step / 2 ? " on" : "")}
              onClick={() => onChange(m.at)}
              disabled={disabled}
              aria-label={`Set ${label} to ${m.label}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
      {hint && <div className="slider-hint">{hint}</div>}
    </div>
  );
}
