import { useMemo } from "react";
import { useStore, type MapFilter } from "@/state/store";
import { mapHudSnapshot } from "@/ui/mapHudData";
import { developableSites } from "@/ui/developable";
import { sf } from "@/ui/format";
import { FIRM_TINT } from "@/map/MapView";
import "./mapHudLegend.css";

/**
 * THE COLOURS UNDER THE OWNERS LENS, REPRODUCED OFF-MAP. The mesh paints a
 * facade by multiplying its stone base by a tint triple (MapView's mesh-tint
 * effect), so the legend runs the same arithmetic on one neutral base and a
 * swatch here lands near the colour the roofline actually shows. The base is
 * an approximation of the generator's mid facade tone — parchment-stone —
 * because the real buildings each carry their own; close is the job, the
 * TRIPLES being the very ones the mesh uses is the guarantee.
 */
const FACADE_BASE: [number, number, number] = [168, 164, 155];
const tintCss = (t: [number, number, number]): string => {
  const c = FACADE_BASE.map((v, i) => Math.max(0, Math.min(255, Math.round(v * t[i]))));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
};
// Your book's gold on the mesh — the holdings triple from MapView's tint
// effect. Copied because MapView exports only the firm palette; if the gold
// there moves, this swatch is a month behind until it moves too.
const HOLDINGS_TINT: [number, number, number] = [1.28, 1.1, 0.72];
// Lots on the market read teal off the LOT, not the massing — the listed
// case in gameLayers (src/map/style.ts) — and at legend zoom the lot is
// what carries. Same copy caveat as the gold.
const LISTED_TEAL = "#3f8f87";

/**
 * Persistent map overlay: next deliveries, balloon cliffs, desk count.
 * Click a row → focus the parcel (or open the inbox route).
 */
export default function MapHud() {
  const game = useStore((s) => s.game);
  const parcels = useStore((s) => s.parcels);
  const openAttention = useStore((s) => s.openAttention);
  const focus = useStore((s) => s.focus);
  const setPage = useStore((s) => s.setPage);
  const lens = useStore((s) => s.lens);
  const setLens = useStore((s) => s.setLens);
  const mapFilter = useStore((s) => s.mapFilter);
  const setMapFilter = useStore((s) => s.setMapFilter);

  const snap = useMemo(() => {
    if (!game || game.gameOver) return null;
    return mapHudSnapshot(game, parcels);
  }, [game, parcels]);

  const ready = useMemo(() => {
    if (!game || !parcels || game.gameOver) return [];
    return developableSites(game, parcels).filter((s) => s.pencils).slice(0, 2);
  }, [game, parcels]);

  // One row per tint slot, not per firm. A firm's slot is its position in
  // game.rivals with the dead still counted, because that is exactly how the
  // mesh picks a colour (MapView: indexOf % 8) — filter first and every
  // swatch shifts off its building by the number of the failed. Past eight
  // living firms the palette wraps, so firms sharing a slot share a row.
  const legendRows = useMemo(() => {
    if (lens !== "owners" || !game) return null;
    const bySlot = new Map<number, { name: string; bbl: string | null; extra: number }>();
    (game.rivals ?? []).forEach((r, i) => {
      if (r.failedM != null || r.bbls.length === 0) return;
      const slot = i % FIRM_TINT.length;
      const cur = bySlot.get(slot);
      if (cur) cur.extra += 1;
      else bySlot.set(slot, { name: r.name, bbl: r.bbls[0] ?? null, extra: 0 });
    });
    return [...bySlot.entries()].map(([slot, v]) => ({
      slot,
      color: tintCss(FIRM_TINT[slot]),
      ...v,
    }));
  }, [lens, game]);

  if (!snap) return null;

  return (
    <aside className="map-hud" aria-label="City status">
      <div className="map-hud-kicker">City</div>

      {snap.attentionN > 0 && snap.firstAttention && (
        <button
          type="button"
          className="map-hud-row map-hud-attn"
          onClick={() => openAttention(snap.firstAttention!.key)}
          title={snap.firstAttention.label}
        >
          <span className="map-hud-label">Desk</span>
          <span className="map-hud-text">
            {snap.attentionN} waiting · {snap.firstAttention.label}
          </span>
        </button>
      )}

      {legendRows && (
        <div className="map-hud-block" role="group" aria-label="Owners lens key">
          <div className="map-hud-label">Owners · who holds what</div>
          <div className="map-hud-legend-row">
            <span
              className="map-hud-swatch"
              style={{ background: tintCss(HOLDINGS_TINT) }}
              aria-hidden="true"
            />
            <span className="map-hud-legend-name">You</span>
          </div>
          {legendRows.map((r) => (
            <button
              key={r.slot}
              type="button"
              className="map-hud-legend-row"
              onClick={() => { if (r.bbl) focus(r.bbl, false); }}
              title={`${r.name} · fly to their book`}
            >
              <span
                className="map-hud-swatch"
                style={{ background: r.color }}
                aria-hidden="true"
              />
              <span className="map-hud-legend-name">{r.name}</span>
              {r.extra > 0 && (
                <span className="map-hud-legend-extra">
                  {r.extra === 1
                    ? "+ 1 firm shares this tint"
                    : `+ ${r.extra} firms share this tint`}
                </span>
              )}
            </button>
          ))}
          <div className="map-hud-legend-row">
            <span
              className="map-hud-swatch"
              style={{ background: LISTED_TEAL }}
              aria-hidden="true"
            />
            <span className="map-hud-legend-name">On the market</span>
          </div>
          <div className="map-hud-legend-row">
            <span
              className="map-hud-swatch"
              style={{ background: tintCss([1, 1, 1]) }}
              aria-hidden="true"
            />
            <span className="map-hud-legend-name">Private holders</span>
          </div>
        </div>
      )}

      {snap.deliveries.length > 0 && (
        <div className="map-hud-block">
          <div className="map-hud-label">Under construction</div>
          {snap.deliveries.map((d) => (
            <button
              key={d.bbl}
              type="button"
              className="map-hud-row"
              onClick={() => focus(d.bbl, true)}
              title={d.label}
            >
              {d.label}
            </button>
          ))}
        </div>
      )}

      {snap.balloons.length > 0 && (
        <div className="map-hud-block">
          <div className="map-hud-label">Balloons · 18 mo</div>
          {snap.balloons.map((b) => (
            <button
              key={b.bbl}
              type="button"
              className={"map-hud-row" + (b.months <= 6 ? " map-hud-urgent" : "")}
              onClick={() => { focus(b.bbl, false); setPage("debt"); }}
              title={b.label}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}

      {ready.length > 0 && (
        <div className="map-hud-block">
          <div className="map-hud-label">Sites ready</div>
          {ready.map((s) => (
            <button
              key={s.bbl}
              type="button"
              className="map-hud-row"
              onClick={() => { setLens("zoning"); focus(s.bbl, true); }}
              title={`${s.address} · residual $${s.residualPsf.toFixed(0)}/sf`}
            >
              {s.address} · pencils
            </button>
          ))}
        </div>
      )}

      {snap.deliveredSf > 0 && (
        <div className="map-hud-meta mono">
          Your deliveries · {sf(snap.deliveredSf)} built
        </div>
      )}

      <div className="map-hud-filters" role="group" aria-label="Map emphasis">
        {([
          ["all", "City"],
          ["owned", "Book"],
          ["construction", "Cranes"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={"map-hud-filter" + (mapFilter === id ? " on" : "")}
            aria-pressed={mapFilter === id}
            onClick={() => setMapFilter(id as MapFilter)}
            title={
              id === "all" ? "Show the whole city"
                : id === "owned" ? "Emphasize your book (dim the rest)"
                  : "Emphasize jobs under construction"
            }
          >
            {label}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="map-hud-row map-hud-lens"
        aria-pressed={lens === "zoning"}
        onClick={() => setLens("zoning")}
        title="Shade lots by unbuilt zoning envelope"
      >
        Zoning lens →
      </button>
    </aside>
  );
}
