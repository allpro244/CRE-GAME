// FLOORPLATE STACKING — a list, not a diagram. Tenant / vacant block per floor.
import { monthLabel } from "@/engine/types";
import type { GameState, Holding } from "@/engine/types";
import type { ParcelRecord } from "@/data/types";
import { assignTenantFloors, blocksOf, stacksOf } from "@/engine/plates";
import { sf } from "@/ui/format";
import { useStore } from "@/state/store";

export function StackingList({
  rec, holding, game, canHold,
}: {
  rec: ParcelRecord;
  holding: Holding;
  game: GameState;
  /** Vacant floor ranges can be pinned as a contiguity hold. */
  canHold?: boolean;
}) {
  assignTenantFloors(rec, holding.tenants);
  const stacks = stacksOf(rec);
  const blocks = holding.blocks ?? blocksOf(rec, holding);
  if (!stacks.length) return null;
  const held = game.leasingPlan?.sheet.byBbl?.[holding.bbl]?.holdBlocks ?? [];
  const rows: {
    key: string;
    floors: string;
    who: string;
    meta: string;
    vacant?: boolean;
    floorLo: number;
    floorHi: number;
  }[] = [];
  for (const t of holding.tenants) {
    if (t.use === "multifamily") continue;
    if (t.floorLo == null || t.floorHi == null) continue;
    rows.push({
      key: `t:${t.name}:${t.startM}`,
      floors: t.floorLo === t.floorHi ? `Fl ${t.floorLo}` : `Fl ${t.floorLo}–${t.floorHi}`,
      who: t.name,
      meta: `${sf(t.sf)} · $${t.rentPsf.toFixed(0)}/sf · exp ${monthLabel(t.endM)}`,
      floorLo: t.floorLo,
      floorHi: t.floorHi,
    });
  }
  for (const b of blocks) {
    const dark = holding.darkMs ?? 0;
    const pinned = held.some((h) => b.floorLo <= h.floorHi && b.floorHi >= h.floorLo
      && (h.untilM == null || game.month < h.untilM));
    rows.push({
      key: `v:${b.id}`,
      floors: b.floorLo === b.floorHi ? `Fl ${b.floorLo}` : `Fl ${b.floorLo}–${b.floorHi}`,
      who: pinned ? `Vacant · ${b.kind} · HELD` : `Vacant · ${b.kind}`,
      meta: `${sf(b.sf)}${dark ? ` · ${dark} mo dark` : ""}`,
      vacant: true,
      floorLo: b.floorLo,
      floorHi: b.floorHi,
    });
  }
  rows.sort((a, b) => a.floorLo - b.floorLo || a.floorHi - b.floorHi);
  return (
    <div className="page-section">
      <div className="page-section-head">Stacking · plates, not suites</div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Floors</th><th>Occupant</th><th className="num">Space</th>
            {canHold && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={r.vacant ? "dim" : ""}>
              <td className="mono">{r.floors}</td>
              <td>{r.who}</td>
              <td className="num">{r.meta}</td>
              {canHold && (
                <td>
                  {r.vacant && (
                    <button
                      className="btn btn-mini"
                      title="Keep these floors whole for a block user"
                      onClick={(e) => {
                        e.stopPropagation();
                        const existing = game.leasingPlan?.sheet.byBbl?.[holding.bbl]?.holdBlocks ?? [];
                        const already = existing.some((h) => h.floorLo === r.floorLo && h.floorHi === r.floorHi);
                        const holdBlocks = already
                          ? existing.filter((h) => !(h.floorLo === r.floorLo && h.floorHi === r.floorHi))
                          : [...existing, { floorLo: r.floorLo, floorHi: r.floorHi }];
                        useStore.getState().setPlanRow({ bbl: holding.bbl }, { holdBlocks });
                      }}
                    >
                      {held.some((h) => h.floorLo === r.floorLo && h.floorHi === r.floorHi) ? "Release" : "Hold"}
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
          {!rows.length && (
            <tr><td colSpan={canHold ? 4 : 3} className="dim">No commercial plates on this deed.</td></tr>
          )}
        </tbody>
      </table>
      <div className="hint">
        A list of who sits on which floors and what is still vacant. Hold keeps a
        contiguous block off the desk for a future full-floor user.
      </div>
    </div>
  );
}
