import { useMemo } from "react";
import { useStore } from "@/state/store";
import { CLASS_COLOR, CLASS_LABEL } from "@/data/types";
import type { AssetClass } from "@/data/types";
import { resolveRec, ownedHoldingValue } from "@/engine/value";
import { usd } from "@/ui/format";
import "./rollups.css";

/**
 * WHERE THE EGGS ARE.
 *
 * Concentration is the risk that does not show up in any single building's
 * numbers: a book of sound deeds that are all offices, or all on the same
 * three blocks, or all let to banks, is one bad decade wide. Three share
 * bars — by use, by district, by tenant trade — with the single biggest
 * exposure named and measured on each.
 *
 * Use and district weigh by appraised value (`ownedHoldingValue`, the same
 * mark the book table prints), because a building is exposure whether or not
 * it is currently earning. The trade bar weighs by contract rent, because a
 * sector you are exposed to THROUGH TENANTS hits the income first.
 */

// The class bar keeps the map's own class colors. District and trade have no
// canonical color, so they cycle the same family — legend and tooltip carry
// the names, the color only separates neighbours.
const CYCLE = [
  "var(--teal)", "var(--gold)",
  CLASS_COLOR.office, CLASS_COLOR.retail, CLASS_COLOR.multifamily, CLASS_COLOR.industrial, CLASS_COLOR.land,
];
const OTHER = "var(--ink-dim)";

interface Share { name: string; amt: number; color: string; }

/** Sort, keep the six biggest, fold the tail into "everything else". */
function shares(m: Map<string, number>, color: (name: string, i: number) => string): Share[] {
  const all = [...m.entries()].sort((a, b) => b[1] - a[1]);
  const head = all.slice(0, 6).map(([name, amt], i) => ({ name, amt, color: color(name, i) }));
  const tail = all.slice(6).reduce((a, [, v]) => a + v, 0);
  if (tail > 0) head.push({ name: "everything else", amt: tail, color: OTHER });
  return head;
}

function Bar({ label, note, list, total }: { label: string; note: string; list: Share[]; total: number }) {
  if (total <= 0 || !list.length) return null;
  return (
    <div className="conc-block">
      <div className="conc-label">{label} · {note}</div>
      <div className="conc-bar">
        {list.map((s) => (
          <div
            key={s.name}
            className="conc-seg"
            style={{ flexGrow: s.amt, backgroundColor: s.color }}
            title={`${s.name} · ${((s.amt / total) * 100).toFixed(0)}% · ${usd(s.amt)}`}
          />
        ))}
      </div>
      <div className="conc-legend">
        {list.map((s) => (
          <span key={s.name} className="conc-key">
            <span className="conc-swatch" style={{ backgroundColor: s.color }} aria-hidden="true" />
            {s.name} <span className="conc-pct">{((s.amt / total) * 100).toFixed(0)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function Concentration() {
  const game = useStore((s) => s.game);
  const parcels = useStore((s) => s.parcels);

  const conc = useMemo(() => {
    if (!game || !parcels) return null;
    const byClass = new Map<string, number>();
    const byDistrict = new Map<string, number>();
    const bySector = new Map<string, number>();
    const classOf = new Map<string, AssetClass>();
    let totV = 0, totRent = 0;
    for (const h of Object.values(game.holdings)) {
      if (game.merged?.[h.bbl]) continue;
      const rec = resolveRec(parcels, game, h.bbl);
      if (!rec) continue;
      const v = ownedHoldingValue(game, parcels, h);
      totV += v;
      const cls = CLASS_LABEL[rec.class];
      byClass.set(cls, (byClass.get(cls) ?? 0) + v);
      classOf.set(cls, rec.class);
      byDistrict.set(rec.district, (byDistrict.get(rec.district) ?? 0) + v);
      for (const t of h.tenants) {
        const rent = t.rentPsf * t.sf;
        totRent += rent;
        // Sectors are lower-case trade names in the engine; a legend is prose.
        const name = t.sector.charAt(0).toUpperCase() + t.sector.slice(1);
        bySector.set(name, (bySector.get(name) ?? 0) + rent);
      }
    }
    return {
      totV, totRent,
      cls: shares(byClass, (name) => CLASS_COLOR[classOf.get(name) ?? "land"]),
      dist: shares(byDistrict, (_, i) => CYCLE[i % CYCLE.length]),
      sect: shares(bySector, (_, i) => CYCLE[i % CYCLE.length]),
    };
  }, [game, parcels]);

  if (!conc || (conc.totV <= 0 && conc.totRent <= 0)) return null;
  const top = (l: Share[], tot: number) =>
    l.length && tot > 0 ? `${l[0].name} ${((l[0].amt / tot) * 100).toFixed(0)}%` : "";

  return (
    <div className="page-section">
      <div className="page-section-head">Concentration</div>
      <Bar label="By use" note={`value-weighted · largest ${top(conc.cls, conc.totV)}`} list={conc.cls} total={conc.totV} />
      <Bar label="By district" note={`value-weighted · largest ${top(conc.dist, conc.totV)}`} list={conc.dist} total={conc.totV} />
      <Bar label="By tenant trade" note={conc.totRent > 0 ? `share of contract rent · largest ${top(conc.sect, conc.totRent)}` : ""} list={conc.sect} total={conc.totRent} />
      <div className="hint">
        A diversified book is the one where the biggest bar can have a bad decade without taking the
        firm with it. Use and district weigh appraised value; the trade bar weighs the rent the leases
        actually pay.
      </div>
    </div>
  );
}
