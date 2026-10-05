// DESIGNING ON THE MAP. The Build desk is a page over the map, so the scheme
// standing on its lot was hidden behind the very desk that drew it. "See it
// on the map" steps out: the desk closes, the camera flies to the lot, and
// this bar keeps the design controls over the map while you look and turn
// the view. Changes go to the scheme's draft, so the desk reopens on them.
import { useStore } from "@/state/store";
import { DesignPicker } from "@/ui/panels/DesignPicker";
import type { BuildingDesign } from "@/engine/types";

export default function DesignPeekBar() {
  const peek = useStore((s) => s.designPeek);
  const p = useStore((s) => s.designPreview);
  const address = useStore((s) => (p ? s.parcels?.[p.bbl]?.address : undefined));
  if (!peek || !p) return null;
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
      <DesignPicker design={p.design} onChange={change} floors={p.floors} compact />
      <div className="btn-row" style={{ marginTop: 8 }}>
        <button type="button" className="btn btn-on" onClick={back}>Back to the Build desk</button>
        <button type="button" className="btn" onClick={done}>Close</button>
      </div>
    </div>
  );
}
