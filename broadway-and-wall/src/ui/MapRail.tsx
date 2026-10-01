import { useState } from "react";
import Docket from "@/ui/docket/Docket";
import MapHud from "@/ui/MapHud";
import CycleDigest from "@/ui/CycleDigest";

/**
 * ONE STACK OVER THE MAP, NOT THREE CARDS IN THREE CORNERS.
 *
 * The docket hung top-left, the city HUD bottom-left and the cycle digest
 * beside it, each with its own anchor, so they collided on short windows and
 * the digest covered the HUD's filters. They now share one column beside the
 * desk rail: the docket on top (what wants you), the city underneath, and the
 * cycle last. Each card keeps its own fold; the column folds as a whole too,
 * when the player wants the whole map.
 */
export default function MapRail() {
  const [shut, setShut] = useState(() => {
    try { return localStorage.getItem("bw:maprail") === "shut"; } catch { return false; }
  });
  const toggle = () => {
    setShut((v) => {
      try { localStorage.setItem("bw:maprail", v ? "open" : "shut"); } catch { /* storage blocked */ }
      return !v;
    });
  };
  return (
    <aside className={"map-rail" + (shut ? " map-rail-shut" : "")} aria-label="Desk and city">
      <button
        type="button"
        className="map-rail-toggle"
        onClick={toggle}
        aria-expanded={!shut}
        title={shut ? "Show the docket, city and cycle cards" : "Hide the cards and see the whole map"}
      >
        <span aria-hidden="true">{shut ? "▸" : "◂"}</span>
        <span className="map-rail-toggle-label">{shut ? "Desk & city" : "Hide"}</span>
      </button>
      {!shut && (
        <div className="map-rail-stack">
          <Docket />
          <MapHud />
          <CycleDigest />
        </div>
      )}
    </aside>
  );
}
