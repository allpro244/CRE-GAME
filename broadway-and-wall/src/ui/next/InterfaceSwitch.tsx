/**
 * Settings rows for the new interface (BUILD_SPEC 2.1, 4.3): which shell, and
 * the default financing a Confirm closes on. Drawn with the Settings page's
 * own row, so they sit in the classic Settings too.
 */
import { useNext } from "./nextStore";
import { buyDesks } from "./buy";

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

const LEVS = [1, 0.85, 0.7, 0.5];

/** Settings › Buying: the lender and the share of its quoted maximum a Confirm takes. */
export function BuyingPreset() {
  const preset = useNext((s) => s.buyPreset);
  const set = useNext((s) => s.setBuyPreset);
  const desks = buyDesks(false);
  return (
    <div className="setting-row">
      <div className="setting-text"><div style={{ fontWeight: 600 }}>Buying</div></div>
      <div className="seg" role="radiogroup" aria-label="Lender">
        {[{ id: "cheapest", lender: "Cheapest" }, { id: "cash", lender: "All cash" }].map((d) => (
          <button key={d.id} type="button" role="radio" aria-checked={preset.product === d.id} className={"seg-btn" + (preset.product === d.id ? " on" : "")} onClick={() => set({ ...preset, product: d.id })}>{d.lender}</button>
        ))}
        <select className="seg-btn" value={desks.some((d) => d.id === preset.product) ? preset.product : ""} onChange={(e) => e.target.value && set({ ...preset, product: e.target.value })} aria-label="Desk">
          <option value="">Desk…</option>
          {desks.map((d) => <option key={d.id} value={d.id}>{d.lender}</option>)}
        </select>
      </div>
      <div className="seg" role="radiogroup" aria-label="Leverage">
        {LEVS.map((l) => (
          <button key={l} type="button" role="radio" aria-checked={preset.lev === l} className={"seg-btn" + (preset.lev === l ? " on" : "")} onClick={() => set({ ...preset, lev: l })}>{Math.round(l * 100)}%</button>
        ))}
      </div>
    </div>
  );
}
