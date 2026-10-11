// THE LOOK OF A NEW BUILDING. The Build desk's Design tab, in the order a
// developer decides it: a shelf of the pattern book (FACADE_GROUPS), a style
// off that shelf, one of its four colourways; then how the building finishes
// at the top — a roof, a tower's crown, or a signature form that is the whole
// tower; and, folded away, the trim paint. Only what this building can carry
// is offered: a style, roof or crown that does not reach its height is not
// listed. Every choice is drawn on the lot in the 3D city as it is made
// (MapView's design preview). Looks only — what the building costs and how it
// wears is the build-quality dial on Programme; see BuildingDesign.
import { useEffect, useState } from "react";
import type { BuildingDesign } from "@/engine/types";
import {
  FACADE_GROUPS, FACADE_STYLES, TRIM_PAINTS, ROOF_CHOICES, CROWN_CHOICES, CROWN_MIN_FLOORS, facadeSwatches,
  type FacadeGroup,
} from "@/map/real/RealCity";
import { SIGNATURE_FORMS, SIGNATURE_MIN_FLOORS, type SignatureForm } from "@/map/real/signature";
import { START_YEAR } from "@/engine/types";
import { useStore } from "@/state/store";

const rgbCss = (c: number[]) => `rgb(${Math.round(Math.min(1, c[0] * 0.85) * 255)},${Math.round(Math.min(1, c[1] * 0.83) * 255)},${Math.round(Math.min(1, c[2] * 0.75) * 255)})`;

const swatchStyle = { width: "100%", aspectRatio: "1 / 1", borderRadius: 4, display: "block" } as const;
const cardStyle = (on: boolean) => ({
  padding: 3, borderRadius: 6, cursor: "pointer",
  border: on ? "2px solid var(--accent, #b8860b)" : "1px solid rgba(0,0,0,0.18)",
  background: "transparent", display: "flex", flexDirection: "column" as const, alignItems: "stretch", gap: 3,
});

function Disclosure({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} aria-expanded={open} onClick={onToggle}>
      {label} {open ? "▾" : "▸"}
    </button>
  );
}

export function DesignPicker({ design, onChange, floors, onPeek, compact }: {
  design: BuildingDesign; onChange: (d: BuildingDesign) => void; floors: number;
  /** step out of the desk to see the scheme on the map */
  onPeek?: () => void;
  compact?: boolean;
}) {
  const chosenStyle = design.facade?.split("#")[0];
  const chosen = FACADE_STYLES.find((f) => f.key === chosenStyle);
  // only the styles this height can wear; the chosen one stays listed even
  // after the floors outgrow it, so the player can see what to change
  const fits = FACADE_STYLES.filter((f) => floors <= f.maxFloors || f.key === chosenStyle);
  const shelves = FACADE_GROUPS.filter((g) => fits.some((f) => f.group === g.key));
  const [shelfPick, setShelf] = useState<FacadeGroup | undefined>(chosen?.group);
  const shelf = shelves.some((g) => g.key === shelfPick) ? shelfPick : chosen?.group;
  const [showLandmarks, setShowLandmarks] = useState(!!design.signature);
  const [showTrim, setShowTrim] = useState(design.trim !== undefined);
  // the swatches on show — the open shelf's styles and the chosen style's
  // colourways — are painted off the first frame, so the tab opens at once
  const shown = [
    ...(shelf ? fits.filter((f) => f.group === shelf).map((f) => f.key) : []),
    ...(chosen ? chosen.variants.map((_, v) => (v ? `${chosen.key}#${v}` : chosen.key)) : []),
  ];
  const shownSig = shown.join(",");
  const [sw, setSw] = useState<Record<string, string>>({});
  useEffect(() => {
    if (shown.every((k) => sw[k])) return;
    const id = window.setTimeout(() => {
      try { const add = facadeSwatches(shown); setSw((o) => ({ ...o, ...add })); } catch { /* the cards stay grey */ }
    }, 30);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownSig]);
  const set = (patch: Partial<BuildingDesign>) => {
    const next = { ...design, ...patch };
    for (const k of Object.keys(next) as (keyof BuildingDesign)[]) if (next[k] === undefined) delete next[k];
    onChange(next);
  };
  // a landmark form is offered from the year the first of its kind went up
  const year = useStore((s) => START_YEAR + Math.floor((s.game?.month ?? 0) / 12));
  const sigBlock = (f: SignatureForm) =>
    floors < f.minFloors ? `${f.name} needs ${f.minFloors} floors or more`
      : year < f.from ? `${f.name} — nobody builds one until about ${f.from}`
        : "";
  const landmarks = floors >= SIGNATURE_MIN_FLOORS ? SIGNATURE_FORMS.filter((f) => !sigBlock(f) || design.signature === f.key) : [];

  // THE TOP is one choice: a roof on a low building, a crown on a tower, or a
  // signature form that replaces both. Picking one clears the others.
  const tops = [
    ...ROOF_CHOICES.filter((r) => floors <= r.maxFloors && !(r.key === "flat" && floors >= CROWN_MIN_FLOORS))
      .map((r) => ({ id: `roof:${r.key}`, name: r.name, patch: { roof: r.key, crown: undefined, signature: undefined } })),
    ...(floors >= CROWN_MIN_FLOORS ? CROWN_CHOICES : [])
      .map((c) => ({ id: `crown:${c.key}`, name: c.name, patch: { crown: c.key, roof: undefined, signature: undefined } })),
  ];
  const topNow = design.signature ? "signature" : design.crown ? `crown:${design.crown}` : design.roof ? `roof:${design.roof}` : "auto";
  const sig = design.signature ? SIGNATURE_FORMS.find((f) => f.key === design.signature) : undefined;

  return (
    <div className="design-picker">
      {onPeek && (
        <button type="button" className="btn btn-on" style={{ marginBottom: 8 }} onClick={onPeek}
          title="Close the desk and fly to the lot: orbit, tilt and spin round the scheme in 3D, and keep designing from a bar on the map">
          View in 3D ▸
        </button>
      )}
      <div className="page-section">Facade</div>
      <div className="btn-row" style={{ flexWrap: "wrap" }}>
        <button type="button" className={"btn" + (!design.facade ? " btn-on" : "")}
          title="The period and the street choose, as they do for every other building in town"
          onClick={() => { setShelf(undefined); set({ facade: undefined }); }}>
          Fits the street
        </button>
        {shelves.map((g) => (
          <button key={g.key} type="button"
            className={"btn" + (shelf === g.key ? " btn-on" : "")}
            style={chosen?.group === g.key && shelf !== g.key ? { outline: "1px dashed currentColor", outlineOffset: -3 } : undefined}
            onClick={() => setShelf(g.key)}>
            {g.name}
          </button>
        ))}
      </div>

      {shelf && (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? 64 : 84}px, 1fr))`, gap: compact ? 5 : 8, margin: "8px 0" }}>
          {fits.filter((f) => f.group === shelf).map((f) => (
            <button key={f.key} type="button" title={`${f.name} — ${f.era}${f.maxFloors < 99 ? ` · to ${f.maxFloors} floors` : ""}`}
              style={cardStyle(chosenStyle === f.key)}
              onClick={() => set({ facade: chosenStyle === f.key ? design.facade : f.key })}>
              {sw[f.key]
                ? <img src={sw[f.key]} alt="" style={swatchStyle} />
                : <div style={{ ...swatchStyle, background: "rgba(0,0,0,0.08)" }} />}
              <span style={{ fontSize: 11, lineHeight: 1.2, textAlign: "center" }}>{f.name}</span>
            </button>
          ))}
        </div>
      )}

      {chosen && (
        <>
          <div className="hint" style={{ marginTop: 4 }}>
            {chosen.name} · {chosen.era}
            {floors > chosen.maxFloors && <span className="neg"> — does not go above {chosen.maxFloors} floors; pick another or take the storeys down</span>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: compact ? 4 : 6, margin: "6px 0 10px", maxWidth: compact ? 260 : 360 }}>
            {chosen.variants.map((name, v) => {
              const key = v ? `${chosen.key}#${v}` : chosen.key;
              return (
                <button key={key} type="button" onClick={() => set({ facade: key })} title={name} style={cardStyle(design.facade === key)}>
                  {sw[key]
                    ? <img src={sw[key]} alt={name} style={swatchStyle} />
                    : <div style={{ ...swatchStyle, background: "rgba(0,0,0,0.08)" }} />}
                  <span style={{ fontSize: 10, lineHeight: 1.15, textAlign: "center" }}>{name}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="page-section">Top</div>
      <div className="btn-row" style={{ flexWrap: "wrap" }}>
        <button type="button" className={"btn" + (topNow === "auto" ? " btn-on" : "")}
          title="The period and the style choose"
          onClick={() => set({ roof: undefined, crown: undefined, signature: undefined })}>Auto</button>
        {tops.map((t) => (
          <button key={t.id} type="button" className={"btn" + (topNow === t.id ? " btn-on" : "")} onClick={() => set(t.patch)}>
            {t.name}
          </button>
        ))}
      </div>

      {landmarks.length > 0 && (
        <>
          <Disclosure label={sig ? `Landmark tower · ${sig.name}` : "Landmark tower"} open={showLandmarks} onToggle={() => setShowLandmarks((o) => !o)} />
          {showLandmarks && (
            <>
              <div className="btn-row" style={{ flexWrap: "wrap", marginTop: 6 }}>
                {landmarks.map((f) => {
                  const revival = f.until !== undefined && year > f.until;
                  return (
                    <button key={f.key} type="button"
                      className={"btn" + (design.signature === f.key ? " btn-on" : "")}
                      title={sigBlock(f) || `${f.name} — ${f.blurb}${revival ? ` (a revival: the type was last built about ${f.until})` : ""}`}
                      onClick={() => set({ signature: f.key, crown: undefined, roof: undefined })}>
                      {f.name}
                    </button>
                  );
                })}
              </div>
              <div className="hint" style={{ marginTop: 4 }}>
                {sig ? `${sig.blurb}. The form is the whole tower, top included.` : "A signature form replaces the tower's massing and its top."}
              </div>
            </>
          )}
        </>
      )}

      <div>
        <Disclosure label={design.trim !== undefined ? `Trim · ${TRIM_PAINTS[design.trim]?.name ?? "Auto"}` : "Trim"} open={showTrim} onToggle={() => setShowTrim((o) => !o)} />
      </div>
      {showTrim && (
        <div className="btn-row" style={{ flexWrap: "wrap", marginTop: 6 }}>
          <button type="button" className={"btn" + (design.trim === undefined ? " btn-on" : "")} onClick={() => set({ trim: undefined })}>Auto</button>
          {TRIM_PAINTS.map((p, i) => (
            <button key={p.name} type="button" className={"btn" + (design.trim === i ? " btn-on" : "")} onClick={() => set({ trim: i })}>
              <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 5, marginRight: 6, background: rgbCss(p.rgb), border: "1px solid rgba(0,0,0,0.25)" }} />
              {p.name}
            </button>
          ))}
        </div>
      )}

      {!compact && (
        <div className="hint" style={{ marginTop: 8 }}>
          The building stands on its lot in the 3D city, in this look, while this tab is open. Looks only — the cost and how it
          wears are the build-quality dial on Programme.
        </div>
      )}
    </div>
  );
}
