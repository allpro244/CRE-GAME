// A labelled range control. Groundwork ran on these: you set the dial and the
// consequence updates under your hand, instead of picking from three canned
// buttons. Every continuous decision in the game should be one of these.
import { useId } from "react";

/** Wide slider bounds — name any price; engine decides whether the other side stays. */
export function widePriceBounds(anchor: number, appraisal = anchor) {
  const a = Math.max(1, anchor);
  const m = Math.max(a, appraisal);
  return {
    min: Math.max(1, Math.round(m * 0.02)),
    max: Math.round(m * 8),
    step: Math.max(1000, Math.round(m / 800)),
  };
}

export default function Slider({
  label, value, min, max, step = 1, onChange, format, hint, marks, disabled, editable,
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
  /** Show a number field so the player can type any price inside min/max. */
  editable?: boolean;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const valueText = format ? format(value) : String(value);
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const commit = (raw: number) => {
    if (!Number.isFinite(raw)) return;
    onChange(Math.round(Math.max(min, Math.min(max, raw))));
  };
  return (
    <div className={"slider" + (disabled ? " slider-off" : "")}>
      <div className="slider-head">
        <span className="slider-label" id={labelId}>{label}</span>
        {editable ? (
          <input
            type="number"
            className="slider-value mono"
            value={value}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            aria-labelledby={labelId}
            onChange={(e) => commit(parseFloat(e.target.value))}
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
        value={value}
        disabled={disabled}
        aria-labelledby={labelId}
        aria-valuetext={valueText}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ "--fill": `${pct}%` } as React.CSSProperties}
      />
      {marks && (
        <div className="slider-marks">
          {marks.map((m) => (
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
