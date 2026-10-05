// THE LOOK OF A NEW BUILDING. The Build desk's Design tab: facade (a style,
// then one of its four elevations, shown as swatches), trim paint, roof and,
// on a tower, its crown. Every choice is drawn on the lot in the 3D city as
// it is made (MapView's design preview). Looks only — what the building costs
// and how it wears is the build-quality dial below this; see BuildingDesign.
import { useEffect, useState } from "react";
import type { BuildingDesign } from "@/engine/types";
import {
  FACADE_STYLES, TRIM_PAINTS, ROOF_CHOICES, CROWN_CHOICES, CROWN_MIN_FLOORS, facadeSwatches,
} from "@/map/real/RealCity";

const rgbCss = (c: number[]) => `rgb(${Math.round(Math.min(1, c[0] * 0.85) * 255)},${Math.round(Math.min(1, c[1] * 0.83) * 255)},${Math.round(Math.min(1, c[2] * 0.75) * 255)})`;

export function DesignPicker({ design, onChange, floors, onPeek, compact }: {
  design: BuildingDesign; onChange: (d: BuildingDesign) => void; floors: number;
  /** step out of the desk to see the scheme on the map */
  onPeek?: () => void;
  compact?: boolean;
}) {
  const chosenStyle = design.facade?.split("#")[0];
  const [browse, setBrowse] = useState<string | undefined>(chosenStyle);
  const style = browse ?? chosenStyle;
  // the swatches are painted once, off the first frame, so the tab opens at once
  const [sw, setSw] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    const id = window.setTimeout(() => { try { setSw(facadeSwatches()); } catch { setSw({}); } }, 30);
    return () => window.clearTimeout(id);
  }, []);
  const set = (patch: Partial<BuildingDesign>) => {
    const next = { ...design, ...patch };
    for (const k of Object.keys(next) as (keyof BuildingDesign)[]) if (next[k] === undefined) delete next[k];
    onChange(next);
  };
  const st = FACADE_STYLES.find((f) => f.key === style);

  return (
    <div className="design-picker">
      {onPeek && (
        <button type="button" className="btn btn-on" style={{ marginBottom: 8 }} onClick={onPeek}
          title="Close the desk and fly to the lot — keep designing from a bar on the map">
          See it on the map ▸
        </button>
      )}
      <div className="page-section">Facade</div>
      <div className="btn-row" style={{ flexWrap: "wrap" }}>
        <button type="button" className={"btn" + (!design.facade ? " btn-on" : "")}
          title="The period and the street choose, as they do for every other building in town"
          onClick={() => { setBrowse(undefined); set({ facade: undefined }); }}>
          Fits the street
        </button>
        {FACADE_STYLES.map((f) => {
          const tooTall = floors > f.maxFloors;
          return (
            <button key={f.key} type="button" disabled={tooTall}
              className={"btn" + (chosenStyle === f.key ? " btn-on" : "")}
              style={style === f.key && chosenStyle !== f.key ? { outline: "1px dashed currentColor", outlineOffset: -3 } : undefined}
              title={tooTall ? `${f.name} does not go above ${f.maxFloors} floors` : `${f.name} — ${f.era}`}
              onClick={() => setBrowse(f.key)}>
              {f.name}
            </button>
          );
        })}
      </div>
      {st && (
        <>
          <div className="hint" style={{ marginTop: 4 }}>{st.name} · {st.era}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: compact ? 5 : 8, margin: "6px 0 10px", maxWidth: compact ? 320 : undefined }}>
            {st.variants.map((name, v) => {
              const key = v ? `${st.key}#${v}` : st.key;
              const on = design.facade === key;
              const tooTall = floors > st.maxFloors;
              return (
                <button key={key} type="button" disabled={tooTall} onClick={() => set({ facade: key })}
                  title={name}
                  style={{
                    padding: 3, borderRadius: 6, cursor: tooTall ? "not-allowed" : "pointer",
                    border: on ? "2px solid var(--accent, #b8860b)" : "1px solid rgba(0,0,0,0.18)",
                    background: "transparent", display: "flex", flexDirection: "column", alignItems: "stretch", gap: 3,
                  }}>
                  {sw?.[key]
                    ? <img src={sw[key]} alt={name} style={{ width: "100%", aspectRatio: "1 / 1", borderRadius: 4, display: "block" }} />
                    : <div style={{ width: "100%", aspectRatio: "1 / 1", borderRadius: 4, background: "rgba(0,0,0,0.08)" }} />}
                  <span style={{ fontSize: 11, lineHeight: 1.2, textAlign: "center" }}>{name}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="page-section">Trim</div>
      <div className="btn-row" style={{ flexWrap: "wrap" }}>
        <button type="button" className={"btn" + (design.trim === undefined ? " btn-on" : "")} onClick={() => set({ trim: undefined })}>Auto</button>
        {TRIM_PAINTS.map((p, i) => (
          <button key={p.name} type="button" className={"btn" + (design.trim === i ? " btn-on" : "")} onClick={() => set({ trim: i })}>
            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 5, marginRight: 6, background: rgbCss(p.rgb), border: "1px solid rgba(0,0,0,0.25)" }} />
            {p.name}
          </button>
        ))}
      </div>

      <div className="page-section">Roof</div>
      <div className="btn-row" style={{ flexWrap: "wrap" }}>
        <button type="button" className={"btn" + (!design.roof ? " btn-on" : "")} onClick={() => set({ roof: undefined })}>Auto</button>
        {ROOF_CHOICES.map((r) => {
          const tooTall = floors > r.maxFloors;
          return (
            <button key={r.key} type="button" disabled={tooTall}
              title={tooTall ? `A ${r.name.toLowerCase()} roof is for buildings of ${r.maxFloors} floors or fewer` : undefined}
              className={"btn" + (design.roof === r.key ? " btn-on" : "")} onClick={() => set({ roof: r.key })}>
              {r.name}
            </button>
          );
        })}
      </div>

      {floors >= CROWN_MIN_FLOORS && (
        <>
          <div className="page-section">Crown</div>
          <div className="btn-row" style={{ flexWrap: "wrap" }}>
            <button type="button" className={"btn" + (!design.crown ? " btn-on" : "")} onClick={() => set({ crown: undefined })}>Auto</button>
            {CROWN_CHOICES.map((c) => (
              <button key={c.key} type="button" className={"btn" + (design.crown === c.key ? " btn-on" : "")} onClick={() => set({ crown: c.key })}>
                {c.name}
              </button>
            ))}
          </div>
        </>
      )}
      {!compact && (
        <div className="hint">
          The building stands on its lot in the 3D city, in this look, while this tab is open. Looks only — the cost and how it
          wears are the build-quality dial below.
        </div>
      )}
    </div>
  );
}
