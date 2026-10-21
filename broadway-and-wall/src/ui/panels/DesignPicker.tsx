// THE LOOK OF A NEW BUILDING. The Build desk's Design tab, in the order a
// developer decides it: a shelf of the pattern book (FACADE_GROUPS), a style
// off that shelf, one of its four colourways; then how the building finishes
// at the top — a roof, a tower's crown, or a signature form that is the whole
// tower; and, folded away, the trim paint. Only what this building can carry
// is offered: a style, roof or crown that does not reach its height is not
// listed. Every choice is drawn on the lot in the 3D city as it is made
// (MapView's design preview). Looks only — what the building costs and how it
// wears is the build-quality dial on Programme; see BuildingDesign.
import { useEffect, useMemo, useState } from "react";
import { KITS, KIT_GROUPS, KIT_COLOURS } from "@/engine/renderView";
import { UNREAL_HOST, formsForLot } from "@/state/unrealHost";
import type { BuildingDesign } from "@/engine/types";
import {
  FACADE_GROUPS, FACADE_STYLES, TRIM_PAINTS, ROOF_CHOICES, CROWN_CHOICES, CROWN_MIN_FLOORS, facadeSwatches,
  type FacadeGroup,
} from "@/map/real/RealCity";
import { SIGNATURE_FORMS, SIGNATURE_MIN_FLOORS, type SignatureForm } from "@/map/real/signature";
import { START_YEAR } from "@/engine/types";
import { useStore } from "@/state/store";

/** The ground storey (BuildingDesign.base). A trading ground floor offers only what keeps its shops. */
const BASES: { key: NonNullable<BuildingDesign["base"]>; name: string; blurb: string; minFloors: number; shops: boolean }[] = [
  { key: "lobby", name: "Glass lobby", blurb: "A double-height glass lobby under the facade", minFloors: 3, shops: false },
  { key: "stone", name: "Stone base", blurb: "A rusticated stone ground storey with round-headed openings", minFloors: 3, shops: false },
  { key: "columns", name: "Columns", blurb: "The building on columns, the lobby glass set back behind them", minFloors: 3, shops: false },
  { key: "arcade", name: "Arcade", blurb: "Round arches along the street, the ground floor behind them", minFloors: 2, shops: true },
  { key: "plain", name: "Same as facade", blurb: "The facade runs down to the pavement", minFloors: 1, shops: false },
];

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

export function DesignPicker({ design, onChange, floors, shops, onPeek, compact }: {
  design: BuildingDesign; onChange: (d: BuildingDesign) => void; floors: number;
  /** the ground floor trades (the Programme's shops at grade): its base is shopfronts or an arcade */
  shops?: boolean;
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
  // What the 3D city found this lot can hold (RealCity onPreviewFits); null
  // until the preview has been drawn once.
  const sigFits = useStore((s) => s.designSigFits);
  const sigBlock = (f: SignatureForm) =>
    floors < f.minFloors ? `${f.name} needs ${f.minFloors} floors or more`
      : year < f.from ? `${f.name} — nobody builds one until about ${f.from}`
        : "";
  const sigNoRoom = (f: SignatureForm) => !!sigFits && !sigBlock(f) && !sigFits.includes(f.key);
  const landmarks = floors >= SIGNATURE_MIN_FLOORS ? SIGNATURE_FORMS.filter((f) => !sigBlock(f) || design.signature === f.key) : [];

  // THE TOP is one choice: a roof on a low building, a crown on a tower, or a
  // signature form that replaces both. Picking one clears the others.
  const tops = [
    ...ROOF_CHOICES.filter((r) => floors <= r.maxFloors && !(r.key === "flat" && floors >= CROWN_MIN_FLOORS))
      .map((r) => ({ id: `roof:${r.key}`, name: r.name, patch: { roof: r.key, crown: undefined, signature: undefined } })),
    ...(floors >= CROWN_MIN_FLOORS ? CROWN_CHOICES : [])
      .map((c) => ({ id: `crown:${c.key}`, name: c.name, patch: { crown: c.key, roof: undefined, signature: undefined } })),
  ];
  // A pitched roof the preview found the footprint cannot carry (RealCity onPreviewFits).
  const roofNoRoom = (id: string) => (id === "roof:gable" || id === "roof:hip") && !!sigFits && !sigFits.includes(id);
  const topNow = design.signature ? "signature" : design.crown ? `crown:${design.crown}` : design.roof ? `roof:${design.roof}` : "auto";
  const sig = design.signature ? SIGNATURE_FORMS.find((f) => f.key === design.signature) : undefined;

  if (UNREAL_HOST) return <KitPicker design={design} set={set} />;

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

      <div className="page-section">Base</div>
      <div className="btn-row" style={{ flexWrap: "wrap" }}>
        <button type="button" className={"btn" + (!design.base ? " btn-on" : "")}
          title={shops ? "Shopfronts at grade, as the Programme has it" : "The period and the style choose"}
          onClick={() => set({ base: undefined })}>{shops ? "Shopfronts" : "Auto"}</button>
        {BASES.filter((b) => (!shops || b.shops) && floors >= b.minFloors).map((b) => (
          <button key={b.key} type="button" className={"btn" + (design.base === b.key ? " btn-on" : "")}
            title={b.blurb} onClick={() => set({ base: b.key })}>{b.name}</button>
        ))}
      </div>
      {shops && design.base && design.base !== "arcade" && (
        <div className="hint">The ground floor trades (Programme), so it keeps its shopfronts.</div>
      )}

      <div className="page-section">Top</div>
      <div className="btn-row" style={{ flexWrap: "wrap" }}>
        <button type="button" className={"btn" + (topNow === "auto" ? " btn-on" : "")}
          title="The period and the style choose"
          onClick={() => set({ roof: undefined, crown: undefined, signature: undefined })}>Auto</button>
        {tops.map((t) => {
          const flat = roofNoRoom(t.id);
          return (
            <button key={t.id} type="button" className={"btn" + (topNow === t.id ? " btn-on" : "")}
              disabled={flat && topNow !== t.id}
              style={flat ? { opacity: 0.45 } : undefined}
              title={flat ? `${t.name} — a pitched roof needs a four-cornered footprint; this one would be drawn flat` : undefined}
              onClick={() => set(t.patch)}>
              {t.name}
            </button>
          );
        })}
      </div>
      {roofNoRoom(topNow) && (
        <div className="hint"><span className="neg">This footprint is not four-cornered, so a pitched roof is drawn flat. Pick another top, or a squarer lot.</span></div>
      )}

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
                      disabled={sigNoRoom(f) && design.signature !== f.key}
                      style={sigNoRoom(f) ? { opacity: 0.45 } : undefined}
                      title={sigBlock(f) || (sigNoRoom(f) ? `${f.name} — this footprint cannot hold it: a bigger site, more lot coverage, or a squarer lot` : `${f.name} — ${f.blurb}${revival ? ` (a revival: the type was last built about ${f.until})` : ""}`)}
                      onClick={() => set({ signature: f.key, crown: undefined, roof: undefined })}>
                      {f.name}
                    </button>
                  );
                })}
              </div>
              <div className="hint" style={{ marginTop: 4 }}>
                {sig && sigNoRoom(sig)
                  ? <span className="neg">This lot cannot hold a {sig.name}: the tower is drawn in its ordinary massing. Assemble a bigger site, raise the lot coverage, or pick a form that is not greyed out.</span>
                  : sig ? `${sig.blurb}. The form is the whole tower, top included.` : "A signature form replaces the tower's massing and its top. Greyed-out forms do not fit this footprint."}
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

/**
 * THE KIT PICKER: the Design tab when Unreal draws the city. Every choice here
 * is something the renderer actually builds (engine/renderView.ts KITS), shown
 * by a picture Unreal took of it (-KitThumbs, served at /game/kits/), and the
 * scheme on the lot redraws as each is picked (unrealHost sends the design).
 */
/**
 * THE BUILDING'S FORM. The lot decides what it can take: each form is solved
 * on the real lot at the scheme's floors and coverage (state/unrealHost.ts
 * formsForLot), and only the ones that fit are offered, each with what it
 * costs in floor area and what it adds in wall. The choice is priced (the pro
 * forma reads both numbers) and drawn (the model shows its tiers).
 */
function FormPicker({ design, set }: { design: BuildingDesign; set: (p: Partial<BuildingDesign>) => void }) {
  const prev = useStore((st) => st.designPreview);
  const options = useMemo(
    () => (prev ? formsForLot(prev.bbl, prev.floors, prev.cov, prev.cls ?? String(prev.use), prev.year ?? START_YEAR) : []),
    [prev?.bbl, prev?.floors, prev?.cov, prev?.cls, prev?.use, prev?.year],
  );
  // the numbers follow the scheme: a change of floors or coverage re-solves the
  // form; a form the lot no longer takes falls back to the plain block
  useEffect(() => {
    if (!design.form || !prev) return;
    const o = options.find((f) => f.key === design.form);
    if (!o) set({ form: undefined, formRetained: undefined, formSkin: undefined });
    else if (Math.abs((design.formRetained ?? 1) - o.retained) > 0.005 || Math.abs((design.formSkin ?? 1) - o.skin) > 0.005)
      set({ formRetained: o.retained, formSkin: o.skin });
  }, [options, design.form]);
  const chip = (on: boolean) => "btn btn-sm" + (on ? " btn-on" : "");
  const pct = (x: number) => (x >= 0 ? "+" : "") + Math.round(x * 100) + "%";
  return (
    <>
      <div className="page-section">Form</div>
      <div className="btn-row" style={{ flexWrap: "wrap", marginBottom: 4 }}>
        <button type="button" className={chip(!design.form)} onClick={() => set({ form: undefined, formRetained: undefined, formSkin: undefined })}
          title="One block to the height the floors make: the most floor area, the least wall">Plain block</button>
        {options.map((f) => (
          <button key={f.key} type="button" className={chip(design.form === f.key)}
            title={`${f.blurb}. Floor area ${pct(f.retained - 1)}, facade ${pct(f.skin - 1)} against the plain block.`}
            onClick={() => set({ form: f.key, formRetained: f.retained, formSkin: f.skin })}>{f.name}</button>
        ))}
      </div>
      <p className="hint">{options.length ? "Only the forms this lot can take at these floors are listed." : "At these floors and this coverage the lot takes only the plain block."}
        {design.form && options.find((f) => f.key === design.form) ? ` ${options.find((f) => f.key === design.form)!.blurb}.` : ""}</p>
    </>
  );
}

function KitPicker({ design, set }: { design: BuildingDesign; set: (p: Partial<BuildingDesign>) => void }) {
  const kit = KITS.find((k) => k.key === design.kit);
  const pick = (k: (typeof KITS)[number] | undefined) =>
    set(k ? { kit: k.key, facade: k.family } : { kit: undefined, facade: undefined, kitColour: undefined, ground: undefined, top: undefined, bays: undefined });
  const chip = (on: boolean) => "btn btn-sm" + (on ? " btn-on" : "");
  return (
    <div className="design-picker">
      <FormPicker design={design} set={set} />
      <div className="page-section">Facade</div>
      <button type="button" className={chip(!design.kit)} style={{ marginBottom: 6 }} onClick={() => pick(undefined)}
        title="The period and the street choose, as they do for every other building in town">Fits the street</button>
      {KIT_GROUPS.map((g) => (
        <div key={g.key} style={{ marginBottom: 6 }}>
          <div className="hint" style={{ margin: "2px 0" }}>{g.name}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))", gap: 6 }}>
            {KITS.filter((k) => k.group === g.key).map((k) => (
              <button key={k.key} type="button" title={`${k.name} — ${k.era}`} onClick={() => pick(k)}
                style={{ padding: 3, borderRadius: 6, cursor: "pointer", background: "transparent", display: "flex", flexDirection: "column", gap: 3,
                  border: design.kit === k.key ? "2px solid var(--accent, #b8860b)" : "1px solid rgba(0,0,0,0.18)" }}>
                <span style={{ display: "block", width: "100%", aspectRatio: "4 / 3", borderRadius: 4, overflow: "hidden", background: "#bcc6cf" }}>
                  <img src={`kits/kit-${k.key}.png`} alt="" loading="lazy"
                    style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scale(2.8)", transformOrigin: "48.5% 51%" }}
                    onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} />
                </span>
                <span style={{ fontSize: 11, lineHeight: 1.2 }}>{k.name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {kit && (<>
        <div className="page-section">Colour</div>
        <div className="btn-row" style={{ flexWrap: "wrap" }}>
          {KIT_COLOURS.map((c, i) => (
            <button key={c.name} type="button" className={chip((design.kitColour ?? 0) === i)} onClick={() => set({ kitColour: i || undefined })}>
              <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, marginRight: 4, verticalAlign: -1,
                background: `rgb(${c.rgb.map((v) => Math.round(Math.min(255, 150 * v))).join(",")})` }} />{c.name}
            </button>
          ))}
        </div>
        <div className="page-section">Street floor</div>
        <div className="btn-row" style={{ flexWrap: "wrap" }}>
          {([[undefined, "Auto"], ["shops", "Shopfronts"], ["entrance", "Entrances"], ["plain", "Same as above"]] as const).map(([k, n]) => (
            <button key={n} type="button" className={chip(design.ground === k)} onClick={() => set({ ground: k })}>{n}</button>
          ))}
        </div>
        <div className="page-section">Top</div>
        <div className="btn-row" style={{ flexWrap: "wrap" }}>
          {([[undefined, "Cornice"], ["plain", "Plain parapet"]] as const).map(([k, n]) => (
            <button key={n} type="button" className={chip(design.top === k)} onClick={() => set({ top: k })}>{n}</button>
          ))}
        </div>
        <p className="hint">{kit.name} · {kit.era}. Looks only — the cost and how it wears are the build-quality dial on Programme.</p>
      </>)}
    </div>
  );
}
