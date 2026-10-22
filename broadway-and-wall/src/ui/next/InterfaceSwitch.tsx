/** Settings › Interface: Classic or New (BUILD_SPEC 2.1). Drawn with the Settings page's own row. */
import { useNext } from "./nextStore";

export function InterfaceSwitch() {
  const v = useNext((s) => s.uiShell);
  const set = useNext((s) => s.setUiShell);
  return (
    <div className="setting-row">
      <div className="setting-text"><div style={{ fontWeight: 600 }}>Interface</div></div>
      <div className="seg" role="radiogroup" aria-label="Interface">
        <button type="button" role="radio" aria-checked={v === "classic"} className={"seg-btn" + (v === "classic" ? " on" : "")} onClick={() => set("classic")}>Classic</button>
        <button type="button" role="radio" aria-checked={v === "next"} className={"seg-btn" + (v === "next" ? " on" : "")} onClick={() => set("next")}>New</button>
      </div>
    </div>
  );
}
