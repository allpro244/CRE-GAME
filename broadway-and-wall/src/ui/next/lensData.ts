/**
 * WHAT EACH LENS PAINTS, AS NUMBERS PER DEED (PLAN §5 step 7).
 *
 * The browser map paints these through MapLibre feature-state (map/MapView);
 * Unreal paints them on its lots from the `lens` bridge message. Both read
 * this one function per lens, so the two cities cannot disagree (R8). Values
 * are 0-100 (pencils 0-200: builder's bid over price, ×100); "owners" is the
 * owning firm's index in `game.rivals` (-1 for you, -2 for a private holder).
 */
import type { GameState } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import type { Lens } from "@/state/store";
import { landRead, liveDemand, occupancy, physicalOcc, resolveRec } from "@/engine/value";
import { ownerOf } from "@/engine/rivals";
import { derive } from "@/ui/derive";

export function lensValues(g: GameState, p: ParcelTable, lens: Lens): Map<string, number> {
  return derive(g, "next.lens:" + lens, () => compute(g, p, lens), [p]);
}

function compute(g: GameState, p: ParcelTable, lens: Lens): Map<string, number> {
  const next = new Map<string, number>();
  switch (lens) {
    case "listings":
      for (const l of g.listings) next.set(l.bbl, g.holdings[l.bbl] ? 50 : 100);
      break;
    case "demand": {
      const drift = g.blockD ?? {};
      for (const bbl of Object.keys(p)) {
        const r = p[bbl];
        if (!drift[r.block]) continue;
        next.set(bbl, Math.round(liveDemand(g, r.demandScore, r.block)));
      }
      break;
    }
    case "land": {
      let top = 0;
      const raw = new Map<string, number>();
      for (const bbl of Object.keys(p)) {
        const rec = resolveRec(p, g, bbl);
        if (!rec || !rec.lotArea) continue;
        const v = landRead(rec, g.econ).psf;
        raw.set(bbl, v);
        if (v > top) top = v;
      }
      for (const [b, v] of raw) next.set(b, top > 0 ? Math.round((100 * v) / top) : 0);
      break;
    }
    case "zoning":
      // the unused share of the resolved envelope; landmarked lots have none
      for (const bbl of Object.keys(p)) {
        const rec = resolveRec(p, g, bbl);
        if (!rec || !rec.lotArea) continue;
        const far = Math.max(rec.farMaxComm, rec.farMaxRes);
        if (!(far > 0)) { next.set(bbl, 0); continue; }
        const used = rec.bldgArea / (rec.lotArea * far);
        next.set(bbl, Math.round(100 * Math.max(0, Math.min(1, 1 - used))));
      }
      break;
    case "leases":
      // months to the next expiry on your deeds: 0-24 months as 100-0
      for (const h of Object.values(g.holdings)) {
        if (h.groundLeased || !h.tenants?.length) continue;
        let soonest = Infinity;
        for (const t of h.tenants) {
          const left = t.endM - g.month;
          if (left >= 0 && left < soonest) soonest = left;
        }
        if (!Number.isFinite(soonest)) continue;
        next.set(h.bbl, Math.round(100 * Math.max(0, 1 - Math.min(24, soonest) / 24)));
      }
      break;
    case "vacancy":
      // per cent occupied: your roll on your deeds, the market's elsewhere
      for (const bbl of Object.keys(p)) {
        const rec = resolveRec(p, g, bbl);
        if (!rec || rec.class === "land" || !rec.bldgArea) continue;
        const h = g.holdings[bbl];
        const occ = h && !h.groundLeased ? physicalOcc(rec, h) : occupancy(rec, g.econ);
        next.set(bbl, Math.round(100 * Math.max(0, Math.min(1, occ))));
      }
      break;
    case "pencils": {
      // a builder's bid for the dirt over its price: the ask when listed, else the market
      const asks = new Map(g.listings.map((l) => [l.bbl, l.ask] as const));
      for (const bbl of Object.keys(p)) {
        if (g.holdings[bbl]) continue;
        const rec = resolveRec(p, g, bbl);
        if (!rec || rec.class !== "land" || !rec.lotArea) continue;
        const read = landRead(rec, g.econ);
        const price = asks.get(bbl) ?? read.psf * rec.lotArea;
        const pay = Math.max(0, read.builder) * rec.lotArea;
        next.set(bbl, Math.round(100 * Math.min(2, price > 0 ? pay / price : 0)));
      }
      break;
    }
    case "owners": {
      const idx = new Map((g.rivals ?? []).map((r, i) => [r.id, i] as const));
      for (const bbl of Object.keys(p)) {
        if (g.holdings[bbl]) { next.set(bbl, -1); continue; }
        const r = ownerOf(g, bbl);
        if (r) next.set(bbl, idx.get(r.id) ?? -2);
      }
      break;
    }
    default:
      break;
  }
  return next;
}
