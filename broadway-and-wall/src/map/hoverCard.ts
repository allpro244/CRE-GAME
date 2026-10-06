// THE HOVER CARD — a building's numbers before you commit to a click.
//
// Everything here is read off the same functions the property panel prints
// (marketAppraisal, goingIn, marketRentPsfYr, ownerAt), so pointing and
// clicking can never disagree about a building. Nothing is computed for the
// card alone. Occupancy is labelled the way the panel labels it: "in place"
// only when the owner has shown a rent roll (or it is yours), otherwise the
// market's estimate — a glance must not leak what a buyer cannot know.
import type { GameState } from "@/engine/types";
import { monthLabel } from "@/engine/types";
import type { ParcelRecord } from "@/data/types";
import { initialCondition, marketAppraisal, marketRentPsfYr, resolveRec } from "@/engine/value";
import { ownerAt } from "@/engine/ownership";
import { goingIn, occRead, useLabel } from "@/ui/panels/shared";
import { usd } from "@/ui/format";

export const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const row = (k: string, v: string, cls = "") =>
  `<div class="ht-row${cls ? " " + cls : ""}"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;

export function tipHtml(g: GameState, parcels: Record<string, ParcelRecord>, rec0: ParcelRecord): string {
  const bbl = rec0.bbl;
  const rec = resolveRec(parcels, g, bbl) ?? rec0;
  const out: string[] = [`<div class="ht-addr">${esc(rec.address)}</div>`];
  const own = g.holdings?.[bbl];
  const o = own ? null : ownerAt(g, parcels, bbl);
  const owner = own ? "You" : o ? o.name : "—";
  const dmd = Math.round(Math.max(2, Math.min(100, rec.demandScore + (g.blockD?.[rec.block] ?? 0))));

  // A SITE WITH A CRANE ON IT IS NOT A VACANT LOT: the parcel stays class
  // "land" until the day it delivers.
  const job = g.developments?.[bbl];
  const cityJob = !job ? (g.cityJobs ?? []).find((j) => j.bbl === bbl) : undefined;
  if (job || cityJob) {
    const j = (job ?? cityJob)!;
    out.push(`<div class="ht-sub">Under construction · ${j.floors} fl ${esc(j.use)}</div>`);
    out.push(row("Size", `${Math.round(j.sf).toLocaleString()} sf`));
    out.push(row("Builder", job ? "You" : cityJob!.firmId ? g.rivals.find((r) => r.id === cityJob!.firmId)?.name ?? "A rival" : "The city"));
    out.push(row(cityJob?.orphaned ? "Status" : "Opens", cityJob?.orphaned ? "stalled" : monthLabel(j.deliverM)));
    return out.join("");
  }

  const listing = g.listings?.find((l) => l.bbl === bbl);
  const cond = own?.condition ?? initialCondition(rec);
  const value = marketAppraisal(g, rec, bbl, cond);
  if (rec.class === "land" || rec.bldgArea <= 0) {
    out.push(`<div class="ht-sub">Vacant lot · ${rec.lotArea.toLocaleString()} sf</div>`);
    out.push(row("Owner", owner));
    out.push(row("Value", usd(value)));
  } else {
    out.push(`<div class="ht-sub">${esc(useLabel(rec))} · ${rec.floors} fl · ${Math.round(rec.bldgArea).toLocaleString()} sf · ${rec.yearBuilt}</div>`);
    out.push(row("Owner", owner));
    let occ: number, occK: string;
    if (own) { occ = occRead(rec, own).lettableOcc; occK = "Occupancy"; }
    else {
      const ip = goingIn(g, bbl, value);
      occ = ip.h ? occRead(rec, ip.h).lettableOcc : ip.occ;
      occK = ip.disclosed ? "Occupancy (in place)" : "Occupancy (mkt est.)";
    }
    out.push(row(occK, `${Math.round(occ * 100)}%`, occ < 0.75 ? "bad" : ""));
    out.push(row("Market rent", `$${marketRentPsfYr(rec, g.econ, cond).toFixed(0)} /sf/yr`));
    out.push(row(own ? "Value (yours)" : "Value", usd(value)));
  }
  if (listing) out.push(row(listing.distress ? "For sale · motivated" : "For sale", usd(listing.ask), "sale"));
  out.push(row("Demand", String(dmd)));
  return out.join("");
}
