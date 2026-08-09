import Slider from "@/ui/Slider";
import { useStore } from "@/state/store";
import { monthLabel, CREDIT_LABEL, serviceSpec, planSpec } from "@/engine/types";
import { marketRentPsfYr, resolveRec, useRentPsfYr, recoveryOf } from "@/engine/value";
import { isCommercial, walt, notReadySf, agentFloor, AGENT_FLOOR_MIN, AGENT_FLOOR_MAX } from "@/engine/leasing";
import { useSf } from "@/engine/mix";
import { portfolioIndustries } from "@/engine/comps";
import { INDUSTRY_LABEL } from "@/engine/market";
import { usd, sf } from "@/ui/format";
import { HousePolicy } from "@/ui/panels/DebtPage";
import { useLabel, physicalOcc, Big } from "@/ui/panels/shared";

export function LeasingPage() {
  const parcels = useStore((s) => s.parcels)!;
  const game = useStore((s) => s.game)!;
  const select = useStore((s) => s.select);
  const setPage = useStore((s) => s.setPage);
  const { setAgent, setRenewalMgmt, setAgentFloor, broker } = useStore.getState();
  const go = (bbl: string) => { setPage("none"); select(bbl); };
  const q = game.month;

  const rows = Object.values(game.holdings).flatMap((h) => {
    const rec = resolveRec(parcels, game, h.bbl);
    if (!rec || rec.class === "land" || !rec.bldgArea) return [];
    const commercial = isCommercial(rec);
    // Both halves of a stacked building count: the shops under lease and the
    // flats above that are occupied.
    const resSf = useSf(rec, "multifamily");
    const leased = h.tenants.reduce((a, t) => a + t.sf, 0) + Math.round((h.occ ?? 0) * resSf);
    const notReady = notReadySf(h, q);
    const occ = physicalOcc(rec as never, h);
    const rentRoll = h.tenants.reduce((a, t) => a + t.rentPsf * t.sf, 0)
      + resSf * useRentPsfYr(rec, game.econ, h.condition, "multifamily") * (h.occ ?? 0);
    const rolling = commercial ? h.tenants.filter((t) => t.endM - q <= 12).reduce((a, t) => a + t.sf, 0) : 0;
    return [{ h, rec, commercial, leased, notReady, occ, rentRoll, rolling }];
  });

  const ind = portfolioIndustries(game);

  if (!rows.length) {
    return (
      <div>
        <AgentBar />
        <RenewalBar />
        <div className="hint">No buildings yet — occupancy starts when you own something with tenants in it.</div>
        {/* …but the house policy belongs here even with an empty book, because
            its other half is the deeds you have not closed yet: set it now and
            everything you buy arrives configured instead of being corrected
            afterwards. That is the whole argument for a default. */}
        <HousePolicy />
      </div>
    );
  }
  const totSf = rows.reduce((a, r) => a + r.rec.bldgArea, 0);
  const totLeased = rows.reduce((a, r) => a + r.leased, 0);
  const totRoll = rows.reduce((a, r) => a + r.rentRoll, 0);
  const totRolling = rows.reduce((a, r) => a + r.rolling, 0);

  function AgentBar() {
    return (
      <div className="agent-bar">
        <div>
          <div className="agent-title">{game.agent ? "Your leasing agent has the book." : "You are handling leasing yourself."}</div>
          <div className="agent-sub">
            {game.agent
              ? "Every LOI that clears the market gets signed for you, at 6% of lease value instead of the 4%/2% you'd pay on your own. Lowballs still get passed."
              : "You'll be asked to sign, counter, or pass on every letter of intent. Hand it over and the decisions stop coming to you."}
          </div>
        </div>
        <button className={"btn" + (game.agent ? "" : " btn-on")} onClick={() => setAgent(!game.agent)}>
          {game.agent ? "Take leasing back" : "Hire the agent · 6%"}
        </button>
      </div>
    );
  }

  /**
   * THE MIDDLE OPTION. The agent above takes the whole book at 6% and signs
   * everything, including the new leases — which is the half worth doing
   * yourself, where you trade term against allowance and decide whether a
   * covenant is worth a discount. This hands over only the RENEWALS: the paper
   * that rolls whether you are paying attention or not.
   *
   * The 2% is not a new charge. `leaseCosts` has always priced a renewal at 2%
   * of rent x sf x term against a new lease's 4%, because a renewal genuinely
   * is less work — no fit-out to negotiate, no tour, no covenant to underwrite.
   * Engaging the desk changes who signs, not what it costs.
   *
   * Hidden while the agent has the book, because the agent is already signing
   * the renewals and offering both would be offering the same thing twice.
   */
  function RenewalBar() {
    if (game.agent) return null;
    const on = !!game.renewalMgmt;
    return (
      <div className="agent-bar">
        <div>
          <div className="agent-title">
            {on ? "Property management has your renewals." : "You are handling your own renewals."}
          </div>
          <div className="agent-sub">
            {on
              ? "Sitting tenants get signed at the market. The manager takes 2% of total lease value on top of the commission a renewal already pays, so a renewal you hand over costs 4% instead of 2%. Anything under the market comes back to you. New leases still land on your desk."
              : "Every renewal letter comes to you six months before expiry, and signing one costs the 2% commission it always has. Hand them over and the routine ones stop asking, for a second 2% to the manager — you keep the new leases, which are the ones worth arguing about."}
          </div>
        </div>
        <button className={"btn" + (on ? "" : " btn-on")} onClick={() => setRenewalMgmt(!on)}>
          {on ? "Take renewals back" : "Management takes renewals · 2%"}
        </button>
      </div>
    );
  }

  /**
   * THE ONE INSTRUCTION YOU GIVE A DESK YOU HAVE HIRED.
   *
   * Delegating leasing is not an all-or-nothing act in life. You hand over the
   * book and you set the terms of the mandate: sign at the market, refer
   * anything materially under it, come and find me if it is worse than X. The
   * game had the mandate — a hardcoded 82% of market, in two places — and just
   * did not let the principal set it, which is the half of the decision that
   * makes delegation a decision at all.
   *
   * Only shown when somebody else is holding the pen. Working your own letters,
   * you ARE the floor.
   */
  function MandateBar() {
    if (!game.agent && !game.renewalMgmt) return null;
    const floor = agentFloor(game);
    return (
      <div className="agent-bar" style={{ display: "block" }}>
        <div className="agent-title">Your mandate to the desk</div>
        <Slider
          label="Sign at no less than"
          value={Math.round(floor * 100)}
          min={Math.round(AGENT_FLOOR_MIN * 100)}
          max={Math.round(AGENT_FLOOR_MAX * 100)}
          step={1}
          onChange={(v) => setAgentFloor(v / 100)}
          marks={[{ at: 75, label: "75%" }, { at: 82, label: "usual" }, { at: 95, label: "95%" }]}
          format={(v) => `${v}% of the market rent for that space`}
          hint={floor >= 0.97
            ? "At the market or nothing. They will refer almost everything back to you, which is a way of not letting space — and every month a suite sits empty costs more than the discount you refused."
            : floor >= 0.88
              ? "A tight mandate. They will sign the good letters and bring you the rest."
              : floor <= 0.72
                ? "A wide mandate. They will fill the building, and some of what they sign will be cheap paper you are stuck with for a decade."
                : "About what a broad leasing mandate looks like: a few points under asking is theirs to sign, worse than that comes back to you."}
        />
        <div className="hint">
          Measured against the market for THAT space — the shop rent for a shop, the office rent for an office —
          not the building's blended average.
        </div>
      </div>
    );
  }

  return (
    <div>
      <AgentBar />
      <RenewalBar />
      <MandateBar />
      <div className="stat-strip">
        <Big label="Portfolio occupancy" value={totSf ? ((100 * totLeased) / totSf).toFixed(1) + "%" : "—"} bad={totSf > 0 && totLeased / totSf < 0.8} />
        <Big label="Leased" value={sf(totLeased) + " of " + sf(totSf)} />
        <Big label="Rent roll / yr" value={usd(totRoll)} />
        <Big label="Rolling in 12 mo" value={sf(totRolling)} bad={totRolling > totLeased * 0.25} />
        <Big label="Open LOIs" value={String(game.lois.length)} />
      </div>

      {/* WHAT YOUR RENT ROLL DOES FOR A LIVING.
          You can own twelve diversified buildings and still be sixty per cent
          finance — and when finance turns you find that out all at once, in
          every building, in the same eighteen months. It is the single most
          important thing a landlord can know about themselves and there was no
          way to see it. */}
      {ind.rows.length > 0 && (
        <div className="page-section">
          <div className="page-section-head">
            Exposure by trade{ind.atRisk > 0.18 ? ` · ${(ind.atRisk * 100).toFixed(0)}% of income in trades that are contracting` : ""}
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Trade</th><th className="num">Share of income</th><th className="num">Income / yr</th>
                <th className="num">Space</th><th className="num">Tenants</th><th>Cycle</th>
              </tr>
            </thead>
            <tbody>
              {ind.rows.map((r) => (
                <tr key={r.sector} className={r.stress > 0.4 ? "dim" : ""}>
                  <td>{INDUSTRY_LABEL[r.sector]}</td>
                  <td className={"num" + (r.share > 0.45 ? " neg" : "")}>{(r.share * 100).toFixed(0)}%</td>
                  <td className="num">{usd(r.income)}</td>
                  <td className="num">{sf(r.sf)}</td>
                  <td className="num">{r.tenants}</td>
                  <td className={r.phase === "bust" ? "neg" : "dim"}>
                    {r.phase === "boom" ? "hiring hard" : r.phase === "bust" ? "contracting" : "steady"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="hint">
            {ind.top && ind.top.share > 0.45
              ? `${(ind.top.share * 100).toFixed(0)}% of your rent comes from ${INDUSTRY_LABEL[ind.top.sector].toLowerCase()}. That is not a rent roll, it is a position in one trade — and both the buyers and the lenders price it that way.`
              : "A rent roll spread across trades survives a bad decade in any one of them. Lenders discount income concentrated in a single industry, and so does anyone buying the building off you."}
          </div>
        </div>
      )}

      <HousePolicy />

      <div className="page-section">
        <div className="page-section-head">By building</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Property</th><th>Class</th><th className="num">Size</th><th className="num">Occupancy</th>
                <th className="num">Rent roll / yr</th><th className="num">Avg rent</th><th className="num">WALT</th>
                <th className="num">Rolling 12mo</th><th>Ask</th><th>Service</th><th>Plan</th><th>Leasing</th>
              </tr>
            </thead>
            <tbody>
              {rows.sort((a, b) => a.occ - b.occ).map((r) => (
                <tr key={r.h.bbl} onClick={() => go(r.h.bbl)}>
                  <td>{r.rec.address}</td>
                  <td>{useLabel(r.rec)}</td>
                  <td className="num">{sf(r.rec.bldgArea)}</td>
                  <td className={"num" + (r.occ < 0.75 ? " neg" : "")}>{(r.occ * 100).toFixed(0)}%</td>
                  <td className="num">{usd(r.rentRoll)}</td>
                  <td className="num">{r.leased ? "$" + (r.rentRoll / r.leased).toFixed(0) : "—"}</td>
                  <td className="num">{r.commercial ? walt(r.h, q).toFixed(1) + "y" : "—"}</td>
                  <td className={"num" + (r.rolling > r.leased * 0.3 ? " neg" : "")}>{r.rolling ? sf(r.rolling) : "—"}</td>
                  {/* THE THREE STANDING DECISIONS, so a book that has drifted off
                      the house policy shows it here rather than one card at a time. */}
                  <td className={(r.h.stance ?? 0) !== (game.opsPolicy?.stance ?? 0) ? "" : "dim"}>
                    {(r.h.stance ?? 0) > 0 ? "Push" : (r.h.stance ?? 0) < 0 ? "Fill" : "Market"}
                  </td>
                  <td className={(r.h.service ?? 0) !== (game.opsPolicy?.service ?? 0) ? "" : "dim"}>
                    {serviceSpec(r.h.service).label}
                  </td>
                  <td className={(r.h.plan ?? 1) !== (game.opsPolicy?.plan ?? 1) ? "" : "dim"}>
                    {planSpec(r.h.plan).label}
                  </td>
                  <td className="dim">
                    {[r.h.broker ? "BROKER" : null, r.notReady ? "TURNING" : null,
                      r.h.deliveredM !== undefined && q - r.h.deliveredM <= 30 ? "LEASE-UP" : null]
                      .filter(Boolean).join(" · ")}
                    {r.commercial && !r.h.broker && r.rec.bldgArea - r.leased > 500 && (
                      <button className="btn btn-mini" onClick={(e) => { e.stopPropagation(); broker(r.h.bbl, true); }}>hire</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="page-section">
        <div className="page-section-head">The rent roll</div>
        <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
          <table className="tbl">
            <thead>
              <tr><th>Tenant</th><th>Sector</th><th>Credit</th><th>Property</th><th className="num">Size</th><th className="num">Rent</th><th>Recovery</th><th className="num">Stop $/sf</th><th className="num">vs mkt</th><th className="num">Expires</th></tr>
            </thead>
            <tbody>
              {rows.flatMap((r) => r.h.tenants.map((t, i) => ({ t, r, i })))
                .sort((a, b) => a.t.endM - b.t.endM)
                .map(({ t, r, i }) => (
                  <tr key={r.h.bbl + ":" + i} onClick={() => go(r.h.bbl)}>
                    <td>{t.name}</td>
                    <td className="dim">{t.sector}</td>
                    <td className="mono">{CREDIT_LABEL[t.credit]}</td>
                    <td className="dim">{r.rec.address}</td>
                    <td className="num">{sf(t.sf)}</td>
                    <td className="num">${t.rentPsf.toFixed(2)}</td>
                    <td className="dim">{recoveryOf(t) === "nnn" ? "NNN" : recoveryOf(t) === "base" ? "base yr" : "gross"}</td>
                    <td className="num dim">{recoveryOf(t) === "base" ? `$${(t.baseStopPsf ?? 0).toFixed(2)}` : "—"}</td>
                    {(() => {
                      const mkt = marketRentPsfYr(r.rec, game.econ, r.h.condition);
                      const d = mkt > 0 ? t.rentPsf / mkt - 1 : 0;
                      return <td className={"num" + (d < -0.12 ? " neg" : "")}>{(d * 100).toFixed(0)}%</td>;
                    })()}
                    <td className={"num" + (t.endM - q <= 12 ? " neg" : "")}>{monthLabel(t.endM)}</td>
                  </tr>
                ))}
              {!rows.some((r) => r.h.tenants.length) && (
                <tr><td colSpan={10} className="dim">Nothing under lease yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * THE TAPE, AS ITS OWN PAGE.
 *
 * Every headline this economy writes was being rendered into a 260px scroll
 * box at the bottom of the Books page, under the ledger and the milestone
 * list — which is the same as not having a news page, and is why the owner
 * asked where it was. Saves was promoted out of that same page for the same
 * reason.
 *
 * The engine keeps the last 120 items (market.ts and sim.ts both trim to it),
 * so this shows all of them rather than a slice, grouped by month so a run of
 * headlines reads as a month rather than as a list, and filterable because in
 * a bad year the warnings are the only ones you want.
 */
