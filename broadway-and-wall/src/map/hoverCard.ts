// THE HOVER CARD — a building's numbers before you commit to a click.
//
// Everything here is read off the same functions the property panel prints
// (marketAppraisal, goingIn, marketRentPsfYr, ownerAt), so pointing and
// clicking can never disagree about a building. Nothing is computed for the
// card alone. Occupancy is labelled the way the panel labels it: "in place"
// only when the owner has shown a rent roll (or it is yours), otherwise the
// market's estimate — a glance must not leak what a buyer cannot know.
import { monthLabel, type GameState } from "@/engine/types";
import type { ParcelRecord } from "@/data/types";
import { initialCondition, marketAppraisal, resolveRec } from "@/engine/value";
import { demandNow } from "@/engine/demand";
import { goingIn, occRead } from "@/ui/panels/shared";
import { usd } from "@/ui/format";

export const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const row = (k: string, v: string, cls = "") =>
  `<div class="ht-row${cls ? " " + cls : ""}"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;

/**
 * THE FOUR NUMBERS (owner, Oct 2026: "Appraised $, occupancy, building sqft,
 * land acreage. Just those"). Read off the same functions the property panel
 * prints, so the glance and the click agree. Occupancy is null on a vacant
 * lot or a site under construction.
 */
export function hoverBasics(g: GameState, parcels: Record<string, ParcelRecord>, rec0: ParcelRecord) {
  const bbl = rec0.bbl;
  const rec = resolveRec(parcels, g, bbl) ?? rec0;
  const own = g.holdings?.[bbl];
  const cond = own?.condition ?? initialCondition(rec);
  const appraised = marketAppraisal(g, rec, bbl, cond);
  const building = rec.class !== "land" && rec.bldgArea > 0 && !g.developments?.[bbl];
  let occ: number | null = null;
  if (building) {
    if (own) occ = occRead(rec, own).lettableOcc;
    else { const ip = goingIn(g, bbl, appraised); occ = ip.h ? occRead(rec, ip.h).lettableOcc : ip.occ; }
  }
  // the demand score the property desk prints (owner, Oct 2026: "when you hover over a parcel, it should show its demand score")
  const demand = Math.round(demandNow(g, rec));
  // UNDER CONSTRUCTION (owner, Oct 2026): when it delivers, how big, what it is —
  // the city's one delivery queue, whoever is building it
  const proj = (g.econ.deliveryQueue ?? []).find((p) => p.bbl === bbl && p.status !== "cancelled" && p.deliverM > g.month);
  const uc = proj ? {
    deliverM: proj.deliverM,
    sf: Math.round(Object.values(proj.sfByUse).reduce((a, v) => a + (v ?? 0), 0)),
    uses: Object.entries(proj.sfByUse).filter(([, v]) => (v ?? 0) > 0).sort((a, b2) => (b2[1] ?? 0) - (a[1] ?? 0)).map(([k]) => USE_WORD[k] ?? k),
    stalled: proj.status === "stalled",
  } : null;
  return { address: rec.address, appraised, occ, demand, uc, bldgSf: building ? Math.round(rec.bldgArea) : 0, acres: rec.lotArea / 43560 };
}

const USE_WORD: Record<string, string> = { office: "Office", retail: "Retail", multifamily: "Apartments", industrial: "Industrial" };

export const acresText = (ac: number) => (ac >= 10 ? ac.toFixed(0) : ac >= 1 ? ac.toFixed(1) : ac.toFixed(2)) + " ac";

export function tipHtml(g: GameState, parcels: Record<string, ParcelRecord>, rec0: ParcelRecord): string {
  const b = hoverBasics(g, parcels, rec0);
  return [
    `<div class="ht-addr">${esc(b.address)}</div>`,
    row("Appraised", usd(b.appraised)),
    row("Demand", `${b.demand} / 100`),
    ...(b.uc ? [
      row("Building", `${b.uc.uses.join(" + ")} · ${b.uc.sf.toLocaleString()} sf`),
      row(b.uc.stalled ? "Stalled · due" : "Delivers", monthLabel(b.uc.deliverM), b.uc.stalled ? "bad" : ""),
    ] : []),
    row("Occupancy", b.occ == null ? "—" : `${Math.round(b.occ * 100)}%`, b.occ != null && b.occ < 0.75 ? "bad" : ""),
    ...(b.uc ? [] : [row("Building", b.bldgSf ? `${b.bldgSf.toLocaleString()} sf` : "—")]),
    row("Land", acresText(b.acres)),
  ].join("");
}
