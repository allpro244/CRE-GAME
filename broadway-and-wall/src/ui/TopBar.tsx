import { useStore } from "@/state/store";

export default function TopBar() {
  const fps = useStore((s) => s.fps);
  const manifest = useStore((s) => s.manifest);
  return (
    <div className="topbar">
      <div className="brand">
        <span className="brand-name">Broadway &amp; Wall</span>
        <span className="brand-sub">
          {manifest?.district === "MN" ? "Manhattan" : "Lower Manhattan · Community District 1"}
        </span>
      </div>
      <div className="topbar-right">
        {manifest?.source === "synthetic" && (
          <span className="badge badge-warn" title="Generated stand-in data — run `pnpm pipeline` on an open network to fetch real PLUTO data.">
            SYNTHETIC DEV DATA
          </span>
        )}
        {manifest && <span className="stat mono">{manifest.lots.toLocaleString()} lots</span>}
        <span className={"stat mono " + (fps >= 55 ? "fps-good" : fps >= 30 ? "fps-ok" : "fps-bad")}>
          {fps} fps
        </span>
      </div>
    </div>
  );
}
