/**
 * The "map" when the game runs inside Unreal: a transparent sheet behind the
 * desks that passes the pointer to the 3D view (state/unrealHost.ts).
 * Coordinates go as fractions of the viewport so the C++ side does not care
 * how CSS pixels map to its widget. A press that does not move is a click
 * (pick a building); a drag with the right button orbits; the wheel zooms.
 */
import { useRef } from "react";
import { sendInput } from "@/state/unrealHost";

export default function UnrealSurface() {
  const down = useRef<{ x: number; y: number; moved: boolean; b: number } | null>(null);
  const frac = (e: { clientX: number; clientY: number }) => ({ x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight });
  return (
    <div
      className="unreal-surface"
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        down.current = { x: e.clientX, y: e.clientY, moved: false, b: e.button };
      }}
      onPointerMove={(e) => {
        const d = down.current;
        if (!d) { sendInput({ t: "hover", ...frac(e) }); return; }
        const dx = e.movementX, dy = e.movementY;
        if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) d.moved = true;
        if (d.moved) sendInput({ t: d.b === 2 ? "orbit" : "pan", dx, dy });
      }}
      onPointerUp={(e) => {
        const d = down.current;
        down.current = null;
        if (d && !d.moved && d.b === 0) sendInput({ t: "click", ...frac(e) });
      }}
      onWheel={(e) => sendInput({ t: "zoom", w: -Math.sign(e.deltaY) })}
    />
  );
}
