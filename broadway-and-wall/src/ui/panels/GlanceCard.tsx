/**
 * THE MAP CARD, AS A GLANCE (owner, 2026-11: "too much information … keep it
 * simpler for understanding properties"). Clicking a building on the map is a
 * question — what is this, is it worth a look — and the card used to answer it
 * with the whole file: twenty rows, the neighbourhood, the tax basis, the
 * adjoining lots. It now answers with four numbers, one line of facts, at most
 * one thing that needs you, and the door into the full file, where everything
 * that left the card still is.
 *
 * Every figure is the one the property page's own header prints (same
 * appraisal, same in-place NOI, same lettable-feet occupancy, same DSCR), so
 * the card and the file cannot disagree.
 */
import type { GameState, Holding } from "@/engine/types";
import type { ParcelRecord, ParcelTable } from "@/data/types";
import { monthLabel } from "@/engine/types";
import { inPlace, landRead, marketRentPsfYr, initialCondition } from "@/engine/value";
import { maxBuildable } from "@/engine/dev";
import { dscr } from "@/engine/debt";
import { walt } from "@/engine/leasing";
import { ownerAt } from "@/engine/ownership";
import { useStore } from "@/state/store";
import { usd, sf } from "@/ui/format";
import { band, useLabel, occRead, occLabel, occTitle } from "@/ui/panels/shared";

function Fig({ k, v, bad, title }: { k: string; v: string; bad?: boolean; title?: string }) {
  return (
    <div className="glance-fig" title={title}>
      <div className="glance-k">{k}</div>
      <div className={"glance-v mono" + (bad ? " neg" : "")}>{v}</div>
    </div>
  );
}

/** The one thing on this deed that needs the owner, if any — most urgent first. */
function needsYou(game: GameState, rec: ParcelRecord, h: Holding): { text: string; tab: "leasing" | "money" | "build" } | null {
  const m = game.month;
  const dev = game.developments[h.bbl];
  if (dev) return { text: `Under construction · delivers ${monthLabel(dev.deliverM)}`, tab: "build" };
  if (h.loan?.sweep) return { text: "Covenant breached · cash swept", tab: "money" };
  if (h.loan && h.loan.maturityM - m <= 12) return { text: `Balloon ${monthLabel(h.loan.maturityM)} · ${usd(h.loan.balance)}`, tab: "money" };
  const soon = h.tenants.filter((t) => t.endM - m <= 12).sort((a, b) => a.endM - b.endM);
  if (soon.length) {
    const feet = soon.reduce((a, t) => a + t.sf, 0);
    return { text: `${soon.length} lease${soon.length === 1 ? " ends" : "s end"} by ${monthLabel(soon[soon.length - 1].endM)} · ${sf(feet)}`, tab: "leasing" };
  }
  const r = rec.class !== "land" && rec.bldgArea > 0 ? occRead(rec, h) : null;
  if (r && r.lettableOcc < 0.6) return { text: `${occLabel(r)} occupied`, tab: "leasing" };
  return null;
}

export function GlanceCard({ game, parcels, rec, bbl, value }: {
  game: GameState; parcels: ParcelTable; rec: ParcelRecord; bbl: string; value: number;
}) {
  const st = useStore.getState();
  const h = game.holdings[bbl];
  const listing = game.listings.find((l) => l.bbl === bbl);
  const dirt = rec.class === "land" || !rec.bldgArea;
  const ip = inPlace(rec, game, bbl, value);
  const occ = ip.h ? occRead(rec, ip.h) : null;
  const owner = h ? null : ownerAt(game, parcels, bbl);
  const open = (tab?: "leasing" | "money" | "build" | "deal") => (tab ? st.openProperty(bbl, tab) : st.setPage("property"));

  // THE AVERAGE RENT A FOOT, off the roll in place (yours, or the one the
  // seller disclosed), against the market for this corner.
  const roll = ip.h?.tenants ?? [];
  const letSf = roll.reduce((a, t) => a + t.sf, 0);
  const avgRent = letSf > 0 ? roll.reduce((a, t) => a + t.sf * t.rentPsf, 0) / letSf : null;
  const mktRent = !dirt ? marketRentPsfYr(rec, game.econ, ip.h?.condition ?? initialCondition(rec)) : 0;

  const facts: string[] = [];
  if (!dirt) facts.push(`${sf(rec.bldgArea)} · ${rec.floors} fl · ${rec.yearBuilt}`);
  facts.push(`lot ${sf(rec.lotArea)}`);
  if (avgRent !== null) facts.push(`rent $${avgRent.toFixed(2)}/sf avg · market $${mktRent.toFixed(2)}`);
  if (h && h.tenants.length) facts.push(`WALT ${walt(h, game.month).toFixed(1)} y`);
  if (dirt) facts.push(`buildable ${sf(maxBuildable(rec).gsf)}`);
  if (owner) facts.push(owner.name);
  // what the building trades at a foot: the ask when it is listed, else the mark
  const pricePsf = !dirt ? (listing && !h ? listing.ask : value) / rec.bldgArea : null;

  const alert = h ? needsYou(game, rec, h) : null;
  const noiYr = ip.noi;
  const dsYr = (h?.loan?.monthlyPmt ?? 0) * 12;
  const d = h?.loan ? dscr(rec, game, h) : null;

  return (
    <div className="glance">
      <div className="glance-figs">
        {dirt ? (
          <>
            <Fig k="Land" v={`$${landRead(rec, game.econ).psf.toFixed(0)}/sf`} title="Land value per sf of lot, as the market reads it today" />
            <Fig k="Value" v={band(bbl, value)} />
            {listing && !h && <Fig k="Ask" v={usd(listing.ask)} />}
          </>
        ) : (
          <>
            {listing && !h
              ? <Fig k="Ask" v={usd(listing.ask)} title={`Appraisal ${band(bbl, value)}`} />
              : <Fig k="Value" v={band(bbl, value)} />}
            <Fig k={listing && !h ? "Cap at ask" : "NOI / yr"}
              v={listing && !h
                ? (() => { const g = inPlace(rec, game, bbl, listing.ask); return g.noi > 0 ? `${((g.noi / listing.ask) * 100).toFixed(2)}%` : "—"; })()
                : usd(noiYr)}
              title={listing && !h ? `In-place NOI ${usd(inPlace(rec, game, bbl, listing.ask).noi)} / yr` : undefined}
              bad={noiYr < 0} />
            <Fig k="Occupancy" v={occ ? occLabel(occ) : `${(ip.occ * 100).toFixed(0)}%`} title={occ ? occTitle(occ) : undefined}
              bad={(occ ? occ.lettableOcc : ip.occ) < 0.75} />
            {pricePsf !== null && <Fig k={listing && !h ? "Ask / sf" : "Value / sf"} v={`$${pricePsf.toFixed(0)}`}
              title={`${listing && !h ? "Ask" : "Appraisal"} ÷ ${sf(rec.bldgArea)} gross`} />}
            {h
              ? (d !== null
                ? <Fig k="DSCR" v={`${d.toFixed(2)}×`} bad={d < (h.loan?.minDSCR ?? 1.2)} title={`Covenant ${(h.loan?.minDSCR ?? 0).toFixed(2)}× · cash flow ${usd(noiYr - dsYr)} / yr`} />
                : <Fig k="Cash flow / yr" v={usd(noiYr - dsYr)} bad={noiYr - dsYr < 0} />)
              : listing ? <Fig k="NOI / yr" v={usd(inPlace(rec, game, bbl, listing.ask).noi)} /> : null}
          </>
        )}
      </div>
      <div className="glance-facts">{useLabel(rec)} · {facts.join(" · ")}</div>
      {alert && (
        <button type="button" className="glance-alert" onClick={() => open(alert.tab)}>{alert.text} →</button>
      )}
      <div className="btn-row glance-acts">
        <button type="button" className="btn btn-sm" onClick={() => open()}>Open file</button>
        {h && <button type="button" className="btn btn-sm" onClick={() => open("deal")}>{h.sale ? "Listed · bids" : "Sell"}</button>}
        {!h && (
          <button type="button" className={"btn btn-sm" + (game.watch?.includes(bbl) ? " btn-on" : "")}
            onClick={() => st.toggleWatch(bbl)} title="Alert when listed">
            {game.watch?.includes(bbl) ? "★ Watching" : "☆ Watch"}
          </button>
        )}
      </div>
    </div>
  );
}
