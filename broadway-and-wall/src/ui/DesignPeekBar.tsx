// DESIGNING ON THE MAP. The Build desk is a page over the map, so the scheme
// standing on its lot was hidden behind the very desk that drew it. "See it
// on the map" steps out: the desk closes, the camera flies to the lot, and
// this bar keeps the design controls over the map while you look and turn
// the view. Changes go to the scheme's draft, so the desk reopens on them.
import { useStore, type DesignCamOp } from "@/state/store";
import { DesignPicker } from "@/ui/panels/DesignPicker";
import type { BuildingDesign } from "@/engine/types";

export default function DesignPeekBar() {
  const peek = useStore((s) => s.designPeek);
  const p = useStore((s) => s.designPreview);
  const address = useStore((s) => (p ? s.parcels?.[p.bbl]?.address : undefined));
  const spin = useStore((s) => s.designSpin);
  const orbit = useStore((s) => s.designOrbit);
  if (!peek || !p) return null;
  const cam = (op: DesignCamOp) => useStore.getState().designCamGo(op);
  const camBtn = (op: DesignCamOp, label: string, title: string) => (
    <button type="button" className="btn btn-sm" title={title} onClick={() => cam(op)}>{label}</button>
  );
  const change = (design: BuildingDesign) => {
    const st = useStore.getState();
    st.setDesignPreview({ ...p, design });
    st.setDevDraft(p.bbl, { design });
  };
  const back = () => {
    const st = useStore.getState();
    st.setDesignPeek(false);
    st.openProperty(p.bbl, "build");
  };
  const done = () => {
    const st = useStore.getState();
    st.setDesignPeek(false);
    st.setDesignPreview(null);
  };
  return (
    <div className="design-peek" style={{
      position: "absolute", right: 16, top: 72, zIndex: 30, width: 360, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 160px)", overflowY: "auto",
      background: "var(--panel, rgba(250,248,243,0.97))", borderRadius: 10, padding: "10px 12px 12px",
      boxShadow: "0 6px 24px rgba(0,0,0,0.22)",
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <strong style={{ fontSize: 14 }}>Designing {address ?? "the scheme"}</strong>
        <span style={{ fontSize: 11, opacity: 0.7 }}>{p.floors} floors</span>
      </div>
      {/* THE VIEWPORT. Turn the camera round the scheme the way a modelling
          program does: orbit, tilt, zoom, a turntable, and back to the
          framed view. Right-drag (or Ctrl-drag) on the map orbits by hand. */}
      <div className="page-section" style={{ marginTop: 6 }}>View</div>
      <div className="btn-row" style={{ flexWrap: "wrap", gap: 4 }}>
        {camBtn("left", "⟲", "Orbit left")}
        {camBtn("right", "⟳", "Orbit right")}
        {camBtn("up", "▲", "Tilt up — towards the plan view")}
        {camBtn("down", "▼", "Tilt down — towards street level")}
        {camBtn("in", "+", "Zoom in")}
        {camBtn("out", "−", "Zoom out")}
        <button type="button" className={"btn btn-sm" + (spin ? " btn-on" : "")}
          title="Turntable — the camera circles the building. Grab the map to stop."
          onClick={() => useStore.getState().setDesignSpin(!spin)}>{spin ? "■ Stop" : "▶ Turntable"}</button>
        {camBtn("reset", "Reset", "Back to the framed view")}
      </div>
      <div className="btn-row" style={{ gap: 4, marginTop: 4 }}>
        <button type="button" className={"btn btn-sm" + (orbit ? " btn-on" : "")} title="Drag turns the camera round the building; scroll zooms in on it"
          onClick={() => useStore.getState().setDesignOrbit(true)}>Turn the building</button>
        <button type="button" className={"btn btn-sm" + (!orbit ? " btn-on" : "")} title="Drag pans the map as usual"
          onClick={() => useStore.getState().setDesignOrbit(false)}>Pan the map</button>
      </div>
      <div className="hint" style={{ fontSize: 11, marginTop: 2 }}>{orbit
        ? "Drag the map to turn round the building — across to orbit, up and down to tilt. Scroll to zoom in on it."
        : "Drag pans the map; right-drag or Ctrl-drag rotates it. “Turn the building” goes back to turning round the scheme."}</div>
      <DesignPicker design={p.design} onChange={change} floors={p.floors} compact />
      <div className="btn-row" style={{ marginTop: 8 }}>
        <button type="button" className="btn btn-on" onClick={back}>Back to the Build desk</button>
        <button type="button" className="btn" onClick={done}>Close</button>
      </div>
    </div>
  );
}
