import { useStore, type Lens, type MapFilter } from "@/state/store";

/**
 * THE MAP'S OWN CONTROLS, ON THE MAP.
 *
 * Six lenses lived in the desk rail between Firm and Campaign, the
 * City / Book / Cranes emphasis lived in the city card, and a "Zoning lens →"
 * button sat under that as a second door to one of the six. All of them change
 * what the map shows and nothing else, so they are one strip along the map's
 * foot: emphasis on the left, lenses on the right, each a toggle.
 */
export const LENSES: readonly { id: Exclude<Lens, "none">; label: string; icon: string; title: string }[] = [
  { id: "listings", label: "For sale", icon: "◉", title: "Market lens — highlight everything for sale on the map" },
  { id: "land", label: "Land", icon: "◧", title: "Land value lens — shade every lot by current land $/sf" },
  { id: "demand", label: "Demand", icon: "◨", title: "Demand lens — transit + employment gravity, the why behind the rents" },
  { id: "zoning", label: "Zoning", icon: "◩", title: "Zoning lens — how much of the allowed envelope is still unbuilt. Bright is room to build; dark is spent, and landmarked lots go black." },
  { id: "owners", label: "Owners", icon: "◫", title: "Owners lens — every building the other firms hold, one colour per firm. Yours stay gold." },
  { id: "leases", label: "Leases", icon: "◬", title: "Lease lens — months to next expiry on buildings you own. Bright is soon; dark is long WALT." },
];

const FILTERS: readonly { id: MapFilter; label: string; title: string }[] = [
  { id: "all", label: "City", title: "Show the whole city" },
  { id: "owned", label: "Book", title: "Emphasize your book (dim the rest)" },
  { id: "construction", label: "Cranes", title: "Emphasize jobs under construction" },
];

export default function MapControls() {
  const lens = useStore((s) => s.lens);
  const setLens = useStore((s) => s.setLens);
  const mapFilter = useStore((s) => s.mapFilter);
  const setMapFilter = useStore((s) => s.setMapFilter);
  const page = useStore((s) => s.page);
  const mapOnly = useStore((s) => s.mapOnly);
  // A desk covers the map; its controls go with it.
  if (page !== "none" && !mapOnly) return null;
  return (
    <div className="map-controls" role="toolbar" aria-label="Map view">
      <div className="map-controls-group" role="group" aria-label="Emphasis">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={"map-controls-btn" + (mapFilter === f.id ? " on" : "")}
            aria-pressed={mapFilter === f.id}
            onClick={() => setMapFilter(f.id)}
            title={f.title}
          >
            {f.label}
          </button>
        ))}
      </div>
      <span className="map-controls-sep" aria-hidden="true" />
      <div className="map-controls-group" role="group" aria-label="Lens">
        {LENSES.map((l) => (
          <button
            key={l.id}
            type="button"
            className={"map-controls-btn" + (lens === l.id ? " on" : "")}
            aria-pressed={lens === l.id}
            onClick={() => setLens(lens === l.id ? "none" : l.id)}
            title={l.title + (lens === l.id ? " (click again to clear)" : "")}
          >
            <span className="map-controls-ico" aria-hidden="true">{l.icon}</span>
            <span className="map-controls-label">{l.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
