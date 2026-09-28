import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import maplibregl from "maplibre-gl";
import { useStore } from "@/state/store";
import type { GameState } from "@/engine/types";
import type { ParcelTable, Adjacency } from "@/data/types";
import { usd } from "@/ui/format";
import "./badges.css";

/**
 * WHAT JUST HAPPENED, WHERE IT HAPPENED. The badges pin standing conditions
 * (a covenant, a balloon); nothing on the map said what the month just did.
 * These rise off the parcel for a few seconds after an advance and fade:
 * a lease signed, a tenant gone, a deed bought or sold, a building delivered,
 * a trade next door to something you own. Every one is a diff of two states
 * of the same campaign — the store's prevForDigest against the live game —
 * so nothing here is a number of its own.
 */
type Pop = { bbl: string; text: string; cls: "good" | "bad" | "info" };

const MAX_POPS = 14;
const LIFE_MS = 5200;

const kSf = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k sf` : `${Math.round(n).toLocaleString()} sf`);

export function popsFor(prev: GameState, next: GameState, parcels: ParcelTable, adjacency: Adjacency | null): Pop[] {
  const out: Pop[] = [];
  const lo = prev.month + 1, hi = next.month;
  const inside = (m?: number) => m !== undefined && m >= lo && m <= hi;
  for (const h of Object.values(next.holdings)) {
    const before = prev.holdings[h.bbl];
    if (!before) { out.push({ bbl: h.bbl, text: "BOUGHT", cls: "info" }); continue; }
    const signed = h.tenants.filter((t) => inside(t.startM) && t.startM > h.boughtM).reduce((a, t) => a + t.sf, 0);
    if (signed > 0) out.push({ bbl: h.bbl, text: `LEASED ${kSf(signed)}`, cls: "good" });
    const names = new Set(h.tenants.map((t) => t.name));
    const gone = before.tenants.filter((t) => !names.has(t.name)).reduce((a, t) => a + t.sf, 0);
    if (gone > 0 && signed === 0) out.push({ bbl: h.bbl, text: `MOVE-OUT ${kSf(gone)}`, cls: "bad" });
    if (prev.developments?.[h.bbl] && !next.developments?.[h.bbl]) out.push({ bbl: h.bbl, text: "DELIVERED", cls: "good" });
  }
  for (const e of next.exits ?? []) {
    if (!inside(e.soldM) || prev.holdings[e.bbl] === undefined) continue;
    out.push({ bbl: e.bbl, text: `SOLD ${usd(e.price)}`, cls: e.forced ? "bad" : "good" });
  }
  // A trade on a lot that touches one of yours: the comp that will reprice you.
  if (adjacency) {
    const mine = new Set(Object.keys(next.holdings));
    for (const n of next.news ?? []) {
      if (!inside(n.q) || n.kind !== "deal" || !n.bbl || mine.has(n.bbl)) continue;
      if (!(adjacency[n.bbl] ?? []).some((b) => mine.has(b))) continue;
      out.push({ bbl: n.bbl, text: "TRADED NEXT DOOR", cls: "info" });
    }
  }
  const seen = new Set<string>();
  return out.filter((p) => parcels[p.bbl] && !seen.has(p.bbl + p.text) && seen.add(p.bbl + p.text)).slice(0, MAX_POPS);
}

export default function EventPops({ mapRef, mapReady }: { mapRef: RefObject<maplibregl.Map | null>; mapReady: boolean }) {
  const game = useStore((s) => s.game);
  const photoFrame = useStore((s) => s.photoFrame);
  // One advance, one rise. Every later action makes a new game object with
  // the same prevForDigest; without this the last month replayed on each.
  const lastPrev = useRef<GameState | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    const { prevForDigest: prev, parcels, adjacency } = useStore.getState();
    if (!mapReady || !map || !game || !prev || !parcels || photoFrame || prev === game) return;
    if (prev === lastPrev.current) return;
    lastPrev.current = prev;
    if (prev.month >= game.month || game.month - prev.month > 36) return;
    const pops = popsFor(prev, game, parcels, adjacency);
    if (!pops.length) return;
    const markers: maplibregl.Marker[] = [];
    pops.forEach((p, i) => {
      const rec = parcels[p.bbl];
      const el = document.createElement("div");
      el.className = `map-pop map-pop-${p.cls}`;
      el.style.animationDelay = `${i * 90}ms`;
      el.textContent = p.text;
      el.setAttribute("aria-hidden", "true");
      markers.push(new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -26] }).setLngLat(rec.centroid).addTo(map));
    });
    const t = setTimeout(() => markers.forEach((m) => m.remove()), LIFE_MS + pops.length * 90);
    return () => { clearTimeout(t); markers.forEach((m) => m.remove()); };
  }, [game, mapReady, photoFrame, mapRef]);
  return null;
}
