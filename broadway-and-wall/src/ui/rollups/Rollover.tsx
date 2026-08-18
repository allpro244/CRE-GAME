import { useMemo } from "react";
import { useStore } from "@/state/store";
import { START_YEAR } from "@/engine/types";
import { resolveRec } from "@/engine/value";
import { usd, sf } from "@/ui/format";
import "./rollups.css";

/**
 * WHEN THE INCOME ROLLS.
 *
 * The rent roll is a stack of contracts, and every contract has a last month.
 * Bucketed by calendar year: how much of the contract rent — and how many
 * square feet — comes up for renewal, eight years out. The shares are the
 * same arithmetic as the exposure grid's "rolling within 2 yrs" line: every
 * tenant on every deed, weighted by what their lease actually pays.
 *
 * A CLUSTER is a quarter of the income expiring into a single year. Leases
 * signed in the same good year all roll in the same later year, and whatever
 * market that year holds reprices all of them at once — the leasing twin of
 * the maturity wall one section up.
 */
export function Rollover() {
  const game = useStore((s) => s.game);
  const parcels = useStore((s) => s.parcels);

  const roll = useMemo(() => {
    if (!game || !parcels) return null;
    const y0 = Math.floor(game.month / 12);
    const years = Array.from({ length: 8 }, (_, i) => ({ yr: y0 + i, rent: 0, sf: 0, n: 0 }));
    let totRent = 0, beyondRent = 0, hasMf = false;
    for (const h of Object.values(game.holdings)) {
      if (game.merged?.[h.bbl]) continue;
      const rec = resolveRec(parcels, game, h.bbl);
      if (rec && (rec.class === "multifamily" || (rec.mix?.multifamily ?? 0) > 0)) hasMf = true;
      for (const t of h.tenants) {
        const rent = t.rentPsf * t.sf;
        totRent += rent;
        // A lease already past its end month is holding over — it is rolling
        // NOW, so it lands in the current year rather than off the left edge.
        const yi = Math.max(0, Math.floor(t.endM / 12) - y0);
        if (yi >= 8) { beyondRent += rent; continue; }
        years[yi].rent += rent;
        years[yi].sf += t.sf;
        years[yi].n++;
      }
    }
    const max = Math.max(1, ...years.map((y) => y.rent));
    return { years, totRent, beyondRent, hasMf, max };
  }, [game, parcels]);

  if (!roll || roll.totRent <= 0) return null;
  const { setPage } = useStore.getState();

  return (
    <div className="page-section">
      <div className="page-section-head">Lease rollover · next eight years</div>
      <div className="roll-rows">
        {roll.years.map((y) => {
          const share = y.rent / roll.totRent;
          const cluster = share > 0.25;
          const label = y.rent > 0
            ? `${START_YEAR + y.yr}: ${y.n} lease${y.n === 1 ? "" : "s"} expire — ${usd(y.rent)} of contract rent, ${(share * 100).toFixed(0)}% of the roll, ${sf(y.sf)}. Open the leasing desk.`
            : `${START_YEAR + y.yr}: nothing expires. Open the leasing desk.`;
          return (
            <button key={y.yr} type="button" className="roll-row" title={label} aria-label={label}
              onClick={() => setPage("leasing")}>
              <span className="roll-year">{START_YEAR + y.yr}</span>
              <div className="roll-track">
                {y.rent > 0 && (
                  <div
                    className={"roll-fill" + (cluster ? " roll-cluster" : "")}
                    style={{ width: `${Math.max(2, (y.rent / roll.max) * 100)}%` }}
                  />
                )}
              </div>
              <span className="roll-amt">
                {y.rent > 0 ? `${usd(y.rent)} · ${(share * 100).toFixed(0)}% · ${sf(y.sf)}` : "—"}
                {cluster && <span className="roll-flag"> · a cluster</span>}
              </span>
            </button>
          );
        })}
      </div>
      {roll.beyondRent > 0 && (
        <div className="hint">
          {usd(roll.beyondRent)} of the roll — {((roll.beyondRent / roll.totRent) * 100).toFixed(0)}% —
          runs past {START_YEAR + roll.years[7].yr}, which is the long paper doing what you signed it for.
        </div>
      )}
      <div className="hint">
        A cluster — over a quarter of the rent expiring into one year — renews at whatever that year's
        market pays, all of it at once.
        {roll.hasMf && " The flats are not on this table: apartments carry no lease paper, and their occupancy churns month to month instead."}
      </div>
    </div>
  );
}
