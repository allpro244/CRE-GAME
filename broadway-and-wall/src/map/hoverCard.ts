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
import { initialCondition, liveDemand, marketAppraisal, marketRentPsfYr, resolveRec } from "@/engine/value";
import { ownerAt } from "@/engine/ownership";
import { goingIn, occRead, useLabel } from "@/ui/panels/shared";
import { usd } from "@/ui/format";
import { deedMark, deedDebtService } from "@/ui/deedMarks";

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
  // from the generated score: `rec` is resolved and already carries the drift
  const dmd = Math.round(liveDemand(g, rec0.demandScore, rec0.block));

  // A SITE WITH A CRANE ON IT IS NOT A VACANT LOT: the parcel stays class
  // "land" until the day it delivers.
  const job = g.developments?.[bbl];
  const cityJob = !job ? (g.cityJobs ?? []).find((j) => j.bbl === bbl) : undefined;
  if (job || cityJob) {
    const j = (job ?? cityJob)!;
    out.push(`<div class="ht-sub">Under construction · ${j.floors} fl ${esc(j.use)}</div>`);
    // WHEN IT DELIVERS, said first: the month, how long to go, how far along
    if (cityJob?.orphaned) out.push(row("Delivery", "stalled — work has stopped", "bad"));
    else {
      const left = Math.max(0, j.deliverM - g.month);
      const total = Math.max(1, j.deliverM - j.startM);
      const pct = Math.round(Math.min(1, Math.max(0, (g.month - j.startM) / total)) * 100);
      out.push(row("Delivers", `${monthLabel(j.deliverM)} · ${left === 0 ? "this month" : `in ${left} month${left === 1 ? "" : "s"}`}`, "sale"));
      out.push(row("Progress", `${pct}% built`));
    }
    out.push(row("Size", `${Math.round(j.sf).toLocaleString()} sf`));
    out.push(row("Builder", job ? "You" : cityJob!.firmId ? g.rivals.find((r) => r.id === cityJob!.firmId)?.name ?? "A competitor" : "The city"));
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
    if (!own) out.push(row("Owner", owner));
    let occ: number, occK: string;
    if (own) { occ = occRead(rec, own).lettableOcc; occK = "Occupancy"; }
    else {
      const ip = goingIn(g, bbl, value);
      occ = ip.h ? occRead(rec, ip.h).lettableOcc : ip.occ;
      occK = ip.disclosed ? "Occupancy (in place)" : "Occupancy (mkt est.)";
    }
    out.push(row(occK, `${Math.round(occ * 100)}%`, occ < 0.75 ? "bad" : ""));
    // YOUR OWN BUILDING ANSWERS A DIFFERENT QUESTION: not what the market
    // pays here, but what this deed puts in your account and when its paper
    // comes due. Same walk as the Portfolio row.
    if (own) {
      const { dsMo } = deedDebtService(g, parcels, bbl);
      const cf = deedMark(g, parcels, bbl).noi / 12 - dsMo;
      out.push(row("Cash flow", `${usd(cf)} /mo`, cf < 0 ? "bad" : ""));
      if (own.loan) out.push(row("Balloon", monthLabel(own.loan.maturityM), own.loan.maturityM - g.month <= 12 ? "bad" : ""));
    } else {
      out.push(row("Market rent", `$${marketRentPsfYr(rec, g.econ, cond).toFixed(0)} /sf/yr`));
    }
    out.push(row(own ? "Value (yours)" : "Value", usd(value)));
  }
  if (listing) out.push(row(listing.distress ? "For sale · motivated" : "For sale", usd(listing.ask), "sale"));
  out.push(row("Demand", String(dmd)));
  return out.join("");
}
