import { useEffect } from "react";
import type { RefObject } from "react";
import maplibregl from "maplibre-gl";
import { useStore } from "@/state/store";
import { monthLabel } from "@/engine/types";
import type { GameState } from "@/engine/types";
import { loiNeedsPrincipal } from "@/engine/leasing";
import { usd } from "@/ui/format";
import type { ParcelTable } from "@/data/types";
import "./badges.css";

/**
 * THE SKYLINE AS A TICKLER FILE.
 *
 * Every fact a chip carries here already lives on a desk — the covenant on
 * the Debt page, the letters on the Deals page, the roll on the Leasing page.
 * What none of those can do is tell you WHERE. A principal watching the town
 * from the air should be able to see which of his buildings has the bank in
 * it, which one balloons next spring, and which one has tenants at the door,
 * without opening a single sheet. So the buildings that need him get a chip
 * pinned to the parcel, and the chip is a door back to the desk that owns
 * the decision.
 *
 * The chips are maplibregl.Markers with our own DOM — the same machinery as
 * the district name labels — so the map keeps them glued to their parcels
 * through every camera move with no per-frame work of ours.
 */

type BadgeCls = "danger" | "warn" | "accent" | "neutral";
type BadgeRoute = "debt" | "property" | "leasing" | "deals" | "focus";
export interface Badge {
  bbl: string;
  glyph: string;
  cls: BadgeCls;
  label: string;
  route: BadgeRoute;
  /** Severity — lower is worse. Decides which fact wins a crowded parcel. */
  rank: number;
  count?: number;
}

// One badge per parcel, worst fact first. A building can be in a workout AND
// carry letters AND face a balloon; the chip shows the thing that costs the
// most to ignore. Meaning is never carried by colour alone — every tier has
// its own glyph, so the chips read in monochrome too.
const RANK_WORKOUT = 0;
const RANK_COVENANT = 1;
const RANK_BALLOON_NEAR = 2;
const RANK_LOI = 3;
const RANK_BALLOON_FAR = 4;
const RANK_ROLLOVER = 5;
const RANK_DELIVERY = 6;

// More chips than this and the skyline becomes a table. Severity decides who
// keeps their pin; a delivery countdown yields to a foreclosure file.
const MAX_BADGES = 48;

// Below this the parcels are too small to own a chip — same idea as the
// station labels, which only come up once the streets are readable.
const BADGE_MIN_ZOOM = 14;

/**
 * Everything on the player's book that deserves a pin. Pure read: the
 * conditions are the same tests the desks run — loan.sweep is the Debt page's
 * SWEPT flag, loiNeedsPrincipal is the Deals queue's own filter, the 12-month
 * roll window is the one the Deals desk lists expiring tenants with. Nothing
 * here is re-derived; a chip and its desk can never disagree.
 */
export function badgesFor(g: GameState, parcels: ParcelTable): Badge[] {
  const m = g.month;
  const best = new Map<string, Badge>();
  const put = (b: Badge) => {
    if (!parcels[b.bbl]) return; // merged ghosts and stale keys get no pin
    const cur = best.get(b.bbl);
    if (!cur || b.rank < cur.rank) best.set(b.bbl, b);
  };

  for (const h of Object.values(g.holdings)) {
    const w = g.workouts?.[h.bbl];
    if (w) {
      put({
        bbl: h.bbl, glyph: "!", cls: "danger", route: "property", rank: RANK_WORKOUT,
        label: `in workout — ${w.cause} · decides ${monthLabel(w.decideM)}`,
      });
    }
    if (h.loan) {
      if (h.loan.sweep || (h.loan.breachMs ?? 0) > 0) {
        put({
          bbl: h.bbl, glyph: "⚖", cls: "danger", route: "debt", rank: RANK_COVENANT,
          label: "covenant — cash swept",
        });
      }
      const mo = h.loan.maturityM - m;
      // Eighteen months is when a refinancing conversation starts; six is when
      // it stops being a conversation. Same window the mesh notice boards use.
      if (mo <= 6) {
        put({
          bbl: h.bbl, glyph: "◷", cls: "danger", route: "debt", rank: RANK_BALLOON_NEAR,
          label: "balloon " + monthLabel(h.loan.maturityM),
        });
      } else if (mo <= 18) {
        put({
          bbl: h.bbl, glyph: "◷", cls: "warn", route: "debt", rank: RANK_BALLOON_FAR,
          label: "balloon " + monthLabel(h.loan.maturityM),
        });
      }
    }
    // Rollover cluster: over a third of the leased feet ending inside a year.
    // Holdovers count as ending — a tenant past their date is the roll risk,
    // not the escape from it. Ground-leased fees are the lessee's problem.
    if (!h.groundLeased && h.tenants.length) {
      let leased = 0, ending = 0;
      for (const t of h.tenants) {
        leased += t.sf;
        if (t.endM - m <= 12) ending += t.sf;
      }
      if (leased > 0 && ending / leased > 0.35) {
        put({
          bbl: h.bbl, glyph: "⟳", cls: "warn", route: "leasing", rank: RANK_ROLLOVER,
          label: "rollover " + Math.round((100 * ending) / leased) + "%",
        });
      }
    }
  }

  // Letters that are actually waiting on the principal — the agent's paper
  // stays off the skyline, exactly as it stays out of the Deals queue.
  const letters = new Map<string, number>();
  for (const l of g.lois ?? []) {
    if (loiNeedsPrincipal(g, l)) letters.set(l.bbl, (letters.get(l.bbl) ?? 0) + 1);
  }
  for (const [bbl, n] of letters) {
    put({
      bbl, glyph: "✉", cls: "accent", route: "deals", rank: RANK_LOI, count: n,
      label: n === 1 ? "1 letter" : `${n} letters`,
    });
  }

  for (const d of Object.values(g.developments ?? {})) {
    put({
      bbl: d.bbl, glyph: "▲", cls: "neutral", route: "focus", rank: RANK_DELIVERY,
      label: "delivers " + monthLabel(d.deliverM),
    });
  }

  return [...best.values()]
    .sort((a, b) => a.rank - b.rank || (a.bbl < b.bbl ? -1 : 1))
    .slice(0, MAX_BADGES);
}

/**
 * The anchored callout on the selected parcel, when there is a negotiation
 * live on it: a contract clock, an owner's number, or a letter with a date on
 * it. One line, and every figure in it is the state's own — theirPrice is what
 * the Deals page prints, never a re-derivation.
 */
interface Callout { bbl: string; text: string }
function calloutFor(g: GameState, bbl: string | null, parcels: ParcelTable): Callout | null {
  if (!bbl || !parcels[bbl]) return null;
  const t = g.talks?.[bbl];
  if (t) {
    if (t.agreed) {
      return { bbl, text: `under contract at ${usd(t.agreedPrice ?? t.theirPrice)} · fund by ${monthLabel(t.closeByM ?? g.month)}` };
    }
    return { bbl, text: `round ${t.round} of ${t.maxRounds} · their ${usd(t.theirPrice)}` };
  }
  // A live approach where the owner has named a number. The reserve is the
  // one figure that must never surface here or anywhere — only the ask.
  const a = g.approaches?.[bbl];
  if (a && !a.refused && !g.holdings[bbl] && a.ask !== undefined) {
    return { bbl, text: `owner would take ${usd(a.ask)}` };
  }
  const onIt = (g.lois ?? []).filter((l) => l.bbl === bbl);
  if (onIt.length) {
    const first = onIt.reduce((p, c) => (c.expiresM < p.expiresM ? c : p));
    return {
      bbl,
      text: onIt.length === 1
        ? `letter — answer by ${monthLabel(first.expiresM)}`
        : `${onIt.length} letters — first dies ${monthLabel(first.expiresM)}`,
    };
  }
  return null;
}

// The badge walk is holdings-cheap but the store ticks on every click, so the
// list is memoised on the game object's identity — the same discipline as
// mapPaintSig. A clone that changed nothing a badge reads still recomputes
// once, and the signature below keeps that from touching the DOM.
let memoGame: GameState | null = null;
let memoParcels: ParcelTable | null = null;
let memoBadges: Badge[] = [];
function cachedBadges(g: GameState, parcels: ParcelTable): Badge[] {
  if (g !== memoGame || parcels !== memoParcels) {
    memoBadges = badgesFor(g, parcels);
    memoGame = g;
    memoParcels = parcels;
  }
  return memoBadges;
}

// Markers are torn down and rebuilt only when this string changes — the
// dynSigRef pattern. It encodes everything the DOM shows, so a stable
// signature is a proof the chips are already right.
const badgeSig = (badges: Badge[], co: Callout | null) =>
  badges.map((b) => `${b.bbl}·${b.glyph}·${b.cls}·${b.label}`).join("|")
  + (co ? `§${co.bbl}·${co.text}` : "");

function routeTo(b: Badge) {
  const st = useStore.getState();
  st.focus(b.bbl);
  if (b.route !== "focus") st.setPage(b.route);
}

function BadgesBody({ mapRef }: { mapRef: RefObject<maplibregl.Map | null> }) {
  // A new city is a new map instance; the markers have to follow it.
  const city = useStore((s) => s.city);
  const sig = useStore((s) =>
    s.game && s.parcels
      ? badgeSig(cachedBadges(s.game, s.parcels), calloutFor(s.game, s.selectedBBL, s.parcels))
      : "");

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const { game, parcels, selectedBBL } = useStore.getState();
    if (!game || !parcels) return;

    const markers: maplibregl.Marker[] = [];
    const fading: HTMLElement[] = [];

    for (const b of cachedBadges(game, parcels)) {
      const rec = parcels[b.bbl];
      if (!rec) continue;
      const el = document.createElement("button");
      el.type = "button";
      el.className = "map-badge" + (b.cls === "neutral" ? "" : " badge-" + b.cls);
      el.title = b.label;
      el.setAttribute("aria-label", `${rec.address} — ${b.label}`);
      const glyph = document.createElement("span");
      glyph.className = "map-badge-glyph";
      glyph.setAttribute("aria-hidden", "true");
      glyph.textContent = b.glyph;
      el.appendChild(glyph);
      if (b.count !== undefined && b.count > 1) {
        const n = document.createElement("span");
        n.className = "map-badge-n mono";
        n.textContent = String(b.count);
        el.appendChild(n);
      }
      el.addEventListener("click", (ev) => {
        // the map's own click handler would re-select whatever lot happens to
        // sit under the chip — the chip's answer is the desk, not the dirt
        ev.stopPropagation();
        routeTo(b);
      });
      fading.push(el);
      markers.push(
        new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -6] })
          .setLngLat(rec.centroid)
          .addTo(map),
      );
    }

    const co = calloutFor(game, selectedBBL, parcels);
    const rec = co ? parcels[co.bbl] : undefined;
    if (co && rec) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "map-badge map-badge-callout";
      el.title = co.text;
      el.setAttribute("aria-label", `${rec.address} — ${co.text}`);
      el.textContent = co.text;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const st = useStore.getState();
        st.focus(co.bbl);
        st.setPage("deals");
      });
      // Below the anchor, so it never covers the parcel's own severity chip.
      // Deliberately exempt from the zoom fade: the player asked about this
      // parcel by selecting it, and the answer should not dissolve on zoom-out.
      markers.push(
        new maplibregl.Marker({ element: el, anchor: "top", offset: [0, 10] })
          .setLngLat(rec.centroid)
          .addTo(map),
      );
    }

    // Same inline-opacity fade as the name labels. pointer-events goes with
    // it — an invisible chip must not eat the click meant for the parcel.
    const fade = () => {
      const on = map.getZoom() >= BADGE_MIN_ZOOM;
      for (const el of fading) {
        el.style.opacity = on ? "1" : "0";
        el.style.pointerEvents = on ? "auto" : "none";
      }
    };
    map.on("zoom", fade);
    fade();

    return () => {
      map.off("zoom", fade);
      for (const mk of markers) mk.remove();
    };
  }, [sig, city, mapRef]);

  return null;
}

interface Props {
  mapRef: RefObject<maplibregl.Map | null>;
  mapReady: boolean;
}

export default function Badges({ mapRef, mapReady }: Props) {
  // Awake guard: the full subscription only mounts once there is anything a
  // badge could say. Photo frame silences all chrome; the paint lenses turn
  // the ground into a colour ramp the parchment chips would sit on top of and
  // fight, so only the plain view and the Owners lens keep them — Owners is
  // the watching mode the badges exist for.
  const photoFrame = useStore((s) => s.photoFrame);
  const lens = useStore((s) => s.lens);
  const awake = useStore((s) => {
    const g = s.game;
    if (!g) return false;
    return Object.keys(g.holdings).length > 0
      || (g.lois ?? []).length > 0
      || Object.keys(g.developments ?? {}).length > 0
      || Object.keys(g.talks ?? {}).length > 0
      || Object.keys(g.approaches ?? {}).length > 0;
  });
  if (!mapReady || photoFrame || !awake) return null;
  if (lens !== "none" && lens !== "owners") return null;
  return <BadgesBody mapRef={mapRef} />;
}
