import { useState } from "react";
import { derive } from "@/ui/derive";
import { useStore } from "@/state/store";
import { monthLabel, CREDIT_LABEL, serviceSpec, planSpec, autoLeaseOnClose } from "@/engine/types";
import { isLeasedFee, marketRentPsfYr, resolveRec, useRentPsfYr, recoveryOf } from "@/engine/value";
import {
  isCommercial, walt, notReadySf,
  deskHoldsPen, deskMonthNow, loiNeedsPrincipal, portfolioOccupancy, autoTiCapToday, autoLeaseRule,
  AUTO_CONCESSIONS, autoConcessionsOf, autoLeaseYear,
} from "@/engine/leasing";
import { PlanEditor, PlanDigest } from "@/ui/panels/PlanSheet";
import { useSf } from "@/engine/mix";
import { portfolioIndustries } from "@/engine/comps";
import { INDUSTRY_LABEL } from "@/engine/market";
import { usd, sf } from "@/ui/format";
import { HousePolicy } from "@/ui/panels/HousePolicyDesk";
import { LoiCard, TrayClear } from "@/ui/panels/DealsPage";
import { useLabel, occRead, occLabel, occTitle, Big } from "@/ui/panels/shared";
import Fold from "@/ui/Fold";
import { Rollover } from "@/ui/rollups/Rollover";
import { WhyButton } from "@/ui/WhyChain";
import { whyGet } from "@/engine/why";
import { OpsChoices } from "@/ui/panels/OpsChoices";
import { BizLink } from "@/ui/BizSheet";

export function LeasingPage() {
  const parcels = useStore((s) => s.parcels)!;
  const game = useStore((s) => s.game)!;
  const select = useStore((s) => s.select);
  const setPage = useStore((s) => s.setPage);
  const {
    setAgent, setRenewalMgmt, broker,
  } = useStore.getState();
  const go = (bbl: string) => { setPage("none"); select(bbl); };
  const q = game.month;

  // Coupon-only fees: the lessee lets the tower. They must not dilute occ /
  // rent-roll totals or offer a "hire broker" button on an empty shell.
  const leasedFees = Object.values(game.holdings).flatMap((h) => {
    if (!isLeasedFee(h)) return [];
    const gl = game.groundLeases?.[h.bbl];
    if (!gl) return [];
    const rec = resolveRec(parcels, game, h.bbl);
    return [{ h, gl, rec }];
  });

  // Once per state (ui/derive): kept across visits in the same month.
  const leaseRows = derive(game, "leasing.rows", () => Object.values(game.holdings).flatMap((h) => {
    // A lot folded into an assemblage is part of the site's deed now — its
    // building was demolished; listing it showed buildings that no longer exist.
    if (isLeasedFee(h) || game.merged?.[h.bbl]) return [];
    const rec = resolveRec(parcels, game, h.bbl);
    if (!rec || rec.class === "land" || !rec.bldgArea) return [];
    const commercial = isCommercial(rec);
    // Both halves of a stacked building count: the shops under lease and the
    // flats above that are occupied.
    const resSf = useSf(rec, "multifamily");
    const leased = h.tenants.reduce((a, t) => a + t.sf, 0) + Math.round((h.occ ?? 0) * resSf);
    const notReady = notReadySf(h, q);
    // The leasing read, not the appraisal read — see occRead. A building whose
    // whole leftover is under the demise floor is fully let, and the feet that
    // cannot be let are named instead of sitting inside a percentage the owner
    // spends a decade chasing.
    const or = occRead(rec, h);
    const occ = or.lettableOcc;
    const rentRoll = h.tenants.reduce((a, t) => a + t.rentPsf * t.sf, 0)
      + resSf * useRentPsfYr(rec, game.econ, h.condition, "multifamily", h.condIdx) * (h.occ ?? 0);
    const rolling = commercial ? h.tenants.filter((t) => t.endM - q <= 12).reduce((a, t) => a + t.sf, 0) : 0;
    return [{ h, rec, commercial, leased, notReady, occ, or, rentRoll, rolling }];
  }), [parcels]);
  // the table below sorts in place: a copy, so the cached order is never disturbed
  const rows = [...leaseRows];

  const ind = derive(game, "leasing.industries", () => portfolioIndustries(game));

  function LeasedFeeStrip() {
    if (!leasedFees.length) return null;
    return (
      <div className="page-section">
        <div className="page-section-head">Leased fees</div>
        <div className="hint" style={{ marginBottom: 8 }}>
          Ground rent only; lessee manages the building.
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Property</th><th>Lessee</th><th className="num">Ground rent / yr</th><th className="num">Reverts</th>
            </tr>
          </thead>
          <tbody>
            {leasedFees.map(({ h, gl, rec }) => (
              <tr key={h.bbl} onClick={() => go(h.bbl)}>
                <td>{rec?.address ?? h.bbl}</td>
                <td className="dim">{gl.tenant}</td>
                <td className="num">{usd(gl.rentYr)}</td>
                <td className="num">{monthLabel(gl.endM)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div>
        {/* The house policy belongs here even with an empty book, because
            its other half is the deeds you have not closed yet: set it now and
            everything you buy arrives configured instead of being corrected
            afterwards. That is the whole argument for a default. It leads the
            page, as it does once there is a book. */}
        <HousePolicy />
        <AgentBar />
        <RenewalBar />
        <DeskActivity />
        <PlanEditor />
        <PlanDigest />
        <LeasedFeeStrip />
        <div className="hint">No leased buildings.</div>
        <button className="btn btn-buy" onClick={() => setPage("market")}>
          Marketplace →
        </button>
      </div>
    );
  }
  // Portfolio occupancy over LETTABLE feet, the same denominator every row
  // uses — from the SAME function the top bar reads, because two surfaces
  // doing their own arithmetic is how this screen totalled gross-minus-
  // remainder while its own rows quoted rentable-minus-remainder, and the
  // top bar quoted a third answer over gross. One function, one answer.
  const totRemainder = rows.reduce((a, r) => a + r.or.remainderSf, 0);
  const po = portfolioOccupancy(game, parcels);
  const totSf = po?.lettableSf ?? 0;
  const totLeased = po?.leasedSf ?? 0;
  const totRoll = rows.reduce((a, r) => a + r.rentRoll, 0);
  const totRolling = rows.reduce((a, r) => a + r.rolling, 0);

  function AgentBar() {
    const referred = (game.lois ?? []).filter((l) => loiNeedsPrincipal(game, l)).length;
    // Two covers, one question: who holds the pen?
    const title = game.agent
      ? "Leasing: outside agent"
      : "Leasing: in-house";
    const sub = game.agent
      ? `6% fee. Signs to plan, counters, declines weak LOIs, refers exceptions${referred ? ` · ${referred} LOI${referred === 1 ? "" : "s"} referred` : ""}.`
      : "All LOIs come to you. Listing brokers source but do not sign. Options: renewals to management (below) or outside agent at 6%.";
    return (
      <div className="agent-bar">
        <div>
          <div className="agent-title">{title}</div>
          <div className="agent-sub">{sub}</div>
        </div>
        <div className="btn-row" style={{ flexShrink: 0 }}>
          {game.agent ? (
            <button className="btn" onClick={() => setAgent(false)}>Bring in-house</button>
          ) : (
            <button className="btn" onClick={() => setAgent(true)}>
              Outside coverage · 6%
            </button>
          )}
        </div>
      </div>
    );
  }

  /**
   * QUIET ACCOUNTABILITY. When somebody else holds the pen, popups stop.
   * Without a tally, a quiet month looks the same as a desk that is turning
   * every tenant away. Signed / passed / referred / walked is the proof.
   */
  function DeskActivity() {
    if (!deskHoldsPen(game)) return null;
    const tally = deskMonthNow(game);
    const referred = (game.lois ?? []).filter((l) => loiNeedsPrincipal(game, l)).length;
    return (
      <div className="agent-bar" style={{ display: "block" }}>
        <div className="agent-title">Desk this month · {monthLabel(game.month)}</div>
        {!tally ? (
          <div className="hint">
            No LOIs this month.
            {referred ? ` ${referred} referred LOI${referred === 1 ? "" : "s"} on Deals.` : ""}
          </div>
        ) : (
          <>
            <div className="stat-strip" style={{ marginTop: 6 }}>
              <Big label="Signed" value={String(tally.signed)}
                title="Signed within mandate" />
              <Big label="Passed" value={String(tally.passed)}
                title="Below mandate; declined" />
              <Big label="Referred" value={String(tally.referred)}
                title="Expansions, capital calls, ties, failed counters" />
              <Big label="Walked" value={String(tally.walked)}
                title="Left after counter" />
              <Big label="Countered" value={String(tally.countered)}
                title="Countered to mandate" />
            </div>
            <div className="hint" style={{ marginTop: 6 }}>
              {tally.signed === 0 && tally.passed > 0 && tally.referred === 0
                ? "Passes only: mandate may be above market."
                : tally.signed > 0
                  ? "Passed LOIs were below mandate."
                  : referred
                    ? `${referred} LOI${referred === 1 ? "" : "s"} on Deals need a decision.`
                    : "No activity."}
            </div>
          </>
        )}
      </div>
    );
  }

  /**
   * THE TEAM, IN ONE CARD. An owner of two hundred buildings does not set a
   * fit-out number per building and does not read two hundred news lines;
   * they set how much the team may give away, switch the book on, and look at
   * a scorecard. Rent posture stays per building (Fill / Market / Push on the
   * rows below) because how hard to hold is a question about one building's
   * lease-up; the concession limit is the firm's.
   */
  function TeamLeasing() {
    const book = rows.filter((r) => r.commercial);
    if (!book.length) return null;
    const on = book.filter((r) => r.h.autoLease).length;
    const allOn = on === book.length;
    const conc = autoConcessionsOf(game);
    const yr = autoLeaseYear(game);
    const settled = yr.signed + yr.passed + yr.walked + yr.referred;
    const pctOf = (x: number) => `${Math.round(x * 100)}%`;
    return (
      <div className="agent-bar" style={{ display: "block" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div className="agent-title">
            Auto-lease · your team answers {on} of {book.length} building{book.length === 1 ? "" : "s"}
          </div>
          <button
            type="button"
            className={"btn btn-mini" + (allOn ? " btn-on" : "")}
            title={allOn
              ? "All buildings on auto-lease. Click to disable."
              : "Auto-lease all buildings at their Fill / Market / Push setting and the concession limit."}
            onClick={() => {
              // the whole book on (or off) is the instruction for the next deed too
              useStore.getState().autoLease(book.map((r) => r.h.bbl), !allOn);
              useStore.getState().autoLeaseNew(!allOn);
            }}
          >{allOn ? "All on ✓" : "Auto-lease every building"}</button>
        </div>
        <div className="lease-ctl" style={{ marginTop: 6 }}>
          <span className="lease-ctl-label">Concessions</span>
          <span className="seg" role="group" aria-label="Max TI and free rent">
            {AUTO_CONCESSIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                className={"btn btn-mini" + (conc === o.key ? " btn-on" : "")}
                aria-pressed={conc === o.key}
                title={`${o.label}: ${o.blurb}.`}
                onClick={() => useStore.getState().autoConcessions(o.key)}
              >{o.label}</button>
            ))}
          </span>
          <button
            type="button"
            className={"btn btn-mini" + (game.autoRentFloor ? " btn-on" : "")}
            aria-pressed={!!game.autoRentFloor}
            title={game.autoRentFloor
              ? "No leases, renewals or relief below market rent. Click to disable."
              : "Floor face rent at market: counter up or pass. Slower lease-up."}
            onClick={() => useStore.getState().autoRentFloor(!game.autoRentFloor)}
          >{game.autoRentFloor ? "Never below market rent ✓" : "Never below market rent"}</button>
          <button
            type="button"
            className={"btn btn-mini" + (autoLeaseOnClose(game) ? " btn-on" : "")}
            aria-pressed={autoLeaseOnClose(game)}
            title={autoLeaseOnClose(game)
              ? "Acquisitions start on auto-lease at house setting. Click to disable."
              : "Start acquisitions on auto-lease."}
            onClick={() => useStore.getState().autoLeaseNew(!autoLeaseOnClose(game))}
          >{autoLeaseOnClose(game) ? "New buildings join auto-lease ✓" : "New buildings join auto-lease"}</button>
        </div>
        <div className="agent-sub" style={{ marginTop: 4 }}>
          TI and free rent: {AUTO_CONCESSIONS.find((o) => o.key === conc)!.blurb}, vs market package per space.
          Rent setting per building below. Leases ≥ 25% of building (10,000 sf+) referred to you.
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          {!settled
            ? "Nothing settled in the last twelve months."
            : <>
                Last 12 months: <b>{yr.signed} signed</b>
                {yr.signed > 0 && <> at <b>{pctOf(yr.deal)} of market deal</b> avg ({pctOf(yr.ne)} net effective vs market{yr.under ? `; ${yr.under} under 90%` : ""})</>}
                {" · "}{yr.passed} passed · {yr.walked} walked · {yr.referred} referred
              </>}
        </div>
      </div>
    );
  }

  /**
   * THE LETTERS THEMSELVES, ON THE LEASING PAGE.
   *
   * An LOI or a renewal used to reach the player as an interrupt card and as a
   * row on Deals, and this page — the one called Leasing — showed a COUNT of
   * them ("On your desk · 3") and nothing else. The owner's report: "when you
   * get LOIs and renewals, they don't pop up in the leasing tab." They did
   * not. Somebody reading their rent roll, seeing a tenant roll in eleven
   * months, had to leave the page to find the renewal letter that tenant had
   * already sent.
   *
   * Same cards, same predicate, same order as the Deals desk — `LoiCard` is
   * imported, not copied, so the two surfaces cannot drift. Referred letters
   * first, then the tours grouped, then arrival order.
   */
  function DeskLetters() {
    const desk = game.lois.filter((l) => loiNeedsPrincipal(game, l));
    if (!desk.length) return null;
    const renewals = desk.filter((l) => l.kind === "renewal").length;
    const quiet = deskHoldsPen(game);
    return (
      <div className="page-section">
        <div className="page-section-head">
          On your desk · {desk.length} LOI{desk.length === 1 ? "" : "s"}
          {renewals ? ` · ${renewals} renewal${renewals === 1 ? "" : "s"}` : ""}
          {quiet ? " · referred" : ""}
        </div>
        <TrayClear />
        <div className="loi-grid">
          {[...desk]
            .sort((a, b) => (b.referred ? 1 : 0) - (a.referred ? 1 : 0)
              || (a.tourId ?? -a.id) - (b.tourId ?? -b.id) || a.id - b.id)
            .map((loi) => <LoiCard key={loi.id} loi={loi} go={go} />)}
        </div>
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
    // Whole-book handoffs already cover renewals.
    if (game.agent) return null;
    const on = !!game.renewalMgmt;
    return (
      <div className="agent-bar">
        <div>
          <div className="agent-title">
            {on ? "Renewals: property management" : "Renewals: in-house"}
          </div>
          <div className="agent-sub">
            {on
              ? "Signed within mandate. +2% of lease value (4% total). Weak renewals referred; junk passed. New leases stay with you."
              : "Renewal LOIs arrive 6 mo before expiry; 2% commission. Management: +2%, new leases stay with you."}
          </div>
        </div>
        <button className={"btn" + (on ? "" : " btn-on")} onClick={() => setRenewalMgmt(!on)}>
          {on ? "Take renewals back" : "Management takes renewals · 2%"}
        </button>
      </div>
    );
  }

  // THE DESK'S SHAPE: what the book says (the strip), what wants you (the
  // letters), what the desk did, and then who holds the pen — a mandate set
  // once and revisited rarely, so it folds to the one line that says who.
  const penLine = game.agent ? "outside agent"
    : game.renewalMgmt ? "in-house · renewals to management"
    : "in-house";
  return (
    <div>
      {/* The house policy is the control on this page that gets used most —
          one setting across the whole book — so it leads, above the numbers
          it moves. */}
      <HousePolicy />
      <div className="stat-strip">
        <Big
          label="Portfolio occupancy"
          value={totSf ? ((100 * Math.min(totLeased, totSf)) / totSf).toFixed(1) + "%" : "—"}
          bad={totSf > 0 && totLeased / totSf < 0.8}
          title={totRemainder
            ? `Leasable basis. ${sf(totRemainder)} below minimum suite size excluded.`
            : "Leased sf / leasable sf."}
        />
        <Big label="Leased" value={sf(totLeased) + " of " + sf(totSf)} />
        <Big label="Rent roll / yr" value={usd(totRoll)} />
        <Big label="Rolling in 12 mo" value={sf(totRolling)} bad={totRolling > totLeased * 0.25} />
        <Big
          label="Pending LOIs"
          value={String(game.lois.filter((l) => loiNeedsPrincipal(game, l)).length)}
          title="Awaiting your decision (also on Deals)"
        />
      </div>

      <TeamLeasing />

      <div className="page-section">
        <div className="page-section-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span>By building</span>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <MinLeaseAll />
          </span>
        </div>
        <div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Property</th>
                <th>Type</th>
                <th className="num">Bldg sf</th>
                <th className="num">Occ</th>
                <th className="num" title="In-place rent / leased sf, vs market">Avg $/sf</th>
                <th className="num">Rent / yr</th>
                <th className="num">WALT</th>
                <th className="num">Rolling</th>
              </tr>
            </thead>
            <tbody>
              {/* biggest building first (owner, Oct 2026) */}
              {rows.sort((a, b) => (b.rec.bldgArea ?? 0) - (a.rec.bldgArea ?? 0)).map((r) => (
                <tr key={r.h.bbl} onClick={() => go(r.h.bbl)}>
                  <td>
                    <div>{r.rec.address}</div>
                    <div className="dim" style={{ fontSize: 11 }}>
                      {/* named, so "Market · Market · Fund" reads as three settings */}
                      rents {((r.h.stance ?? 0) > 0 ? "Push" : (r.h.stance ?? 0) < 0 ? "Fill" : "Market").toLowerCase()}
                      {r.h.autoLease ? (autoTiCapToday(game, r.h) !== undefined ? ` · auto, TI ≤ $${autoTiCapToday(game, r.h)!.toFixed(2)}/yr` : " · auto") : ""}
                      {" · service "}{serviceSpec(r.h.service).label.toLowerCase()}
                      {" · capex "}{planSpec(r.h.plan).label.toLowerCase()}
                      {r.h.broker ? " · broker" : ""}
                      {r.notReady ? " · turning" : ""}
                      {r.h.deliveredM !== undefined && q - r.h.deliveredM <= 30 ? " · lease-up" : ""}
                    </div>
                    {/* THE CONTROLS GET NAMES. Six bare chips — "Fill Market
                        Push auto I sign here list" — ran on from the status
                        line as if they were more of it. The three rent
                        postures are one choice, so they are one segmented
                        control with a label; the switches say what they do. */}
                    <div className="lease-ctl" onClick={(e) => e.stopPropagation()}>
                      <span className="lease-ctl-label">Asking</span>
                      <span className="seg" role="group" aria-label={`Asking rents at ${r.rec.address}`}>
                      {([-1, 0, 1] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          className={"btn btn-mini" + ((r.h.stance ?? 0) === v ? " btn-on" : "")}
                          title={v === 1 ? "+8% asking rents, fewer LOIs" : v === -1 ? "−8% rents, faster lease-up" : "Market rents"}
                          onClick={(e) => { e.stopPropagation(); useStore.getState().stance(r.h.bbl, v); }}
                          aria-pressed={(r.h.stance ?? 0) === v}
                        >{v === 1 ? "Push +8%" : v === -1 ? "Fill −8%" : "Market"}</button>
                      ))}
                      </span>
                      <button
                        type="button"
                        className={"btn btn-mini" + (r.h.autoLease ? " btn-on" : "")}
                        title={r.h.autoLease ? `${autoLeaseRule(game, r.h)} Click to disable.` : "Auto-respond to LOIs at rent setting and concession limit."}
                        onClick={(e) => { e.stopPropagation(); useStore.getState().autoLease(r.h.bbl, !r.h.autoLease); }}
                        aria-pressed={!!r.h.autoLease}
                      >{r.h.autoLease ? "Auto-answer ✓" : "Auto-answer"}</button>
                      {r.commercial && (
                        <button
                          className={"btn btn-mini" + (r.h.principalSigns ? " btn-on" : "")}
                          title={r.h.principalSigns
                            ? "All LOIs here come to you. Click to return to agent."
                            : "Route this building's LOIs to you regardless of agent."}
                          onClick={(e) => { e.stopPropagation(); useStore.getState().setPrincipalSigns(r.h.bbl, !r.h.principalSigns); }}
                        >{r.h.principalSigns ? "I sign here ✓" : "I sign here"}</button>
                      )}
                      {r.commercial && !r.h.broker && r.rec.bldgArea - r.leased > 500 && (
                        <button className="btn btn-mini" title="Listing broker: sources tenants, you sign" onClick={(e) => { e.stopPropagation(); broker(r.h.bbl, true); }}>Hire a broker</button>
                      )}
                    </div>
                    {/* HOW IT IS RUN, FROM THE ROW. Service and the capital plan
                        lived only on each building's Operations tab — a click
                        into every deed to set the book. The same component as
                        the property page and Portfolio, so the row carries the
                        same numbers: what each choice costs a year against the
                        one in force, how tenants read the service, and the
                        building's condition and reserve. */}
                    <div onClick={(e) => e.stopPropagation()}>
                      <OpsChoices bbl={r.h.bbl} h={r.h} compact />
                    </div>
                  </td>
                  <td>{useLabel(r.rec)}</td>
                  <td className="num">{sf(r.rec.bldgArea)}</td>
                  <td className={"num" + (r.occ < 0.75 ? " neg" : "")} title={occTitle(r.or)}>{occLabel(r.or)}{(() => {
                    // WHY A FLAT EMPTIED: the households that left this month, and why (households.ts)
                    const id = game.households?.flatWhy?.[r.h.bbl];
                    const ev = whyGet(game, id);
                    if (!ev || ev.m !== game.month) return null;
                    const n = ev.n?.households ?? 0;
                    return <div className="dim" style={{ fontSize: 11 }} onClick={(e) => e.stopPropagation()}>{n} household{n === 1 ? "" : "s"} left <WhyButton id={id} /></div>;
                  })()}</td>
                  {(() => {
                    // IN PLACE AGAINST THE MARKET. The rent roll over the feet
                    // it is paid on, beside what the same space lets for today.
                    const avg = r.leased > 0 ? r.rentRoll / r.leased : 0;
                    const mkt = marketRentPsfYr(r.rec, game.econ, r.h.condition, r.h.condIdx);
                    const gap = avg > 0 && mkt > 0 ? avg / mkt - 1 : 0;
                    return (
                      <td className="num" title={mkt > 0 ? `In place $${avg.toFixed(2)}/sf against a $${mkt.toFixed(2)}/sf market` : undefined}>
                        {avg > 0 ? `$${avg.toFixed(2)}` : "—"}
                        {avg > 0 && mkt > 0 && (
                          <div className={"dim" + (gap < -0.1 ? " neg" : "")} style={{ fontSize: 11 }}>
                            mkt ${mkt.toFixed(0)} · {gap >= 0 ? "+" : "−"}{Math.abs(Math.round(gap * 100))}%
                          </div>
                        )}
                      </td>
                    );
                  })()}
                  <td className="num">{usd(r.rentRoll)}</td>
                  <td className="num">{r.commercial ? walt(r.h, q).toFixed(1) + "y" : "—"}</td>
                  <td className={"num" + (r.rolling > r.leased * 0.3 ? " neg" : "")}>{r.rolling ? sf(r.rolling) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <DeskLetters />
      <DeskActivity />
      <Fold id="leasing:mandate" title="Leasing mandate" summary={penLine}>
        <AgentBar />
        <RenewalBar />
        <PlanEditor />
        <PlanDigest />
      </Fold>

      {/* WHAT YOUR RENT ROLL DOES FOR A LIVING.
          You can own twelve diversified buildings and still be sixty per cent
          finance — and when finance turns you find that out all at once, in
          every building, in the same eighteen months. It is the single most
          important thing a landlord can know about themselves and there was no
          way to see it. */}
      {ind.rows.length > 0 && (
        <div className="page-section">
          <div className="page-section-head">
            Exposure by industry{ind.atRisk > 0.18 ? ` · ${(ind.atRisk * 100).toFixed(0)}% of income in contracting industries` : ""}
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Industry</th><th className="num">Share of income</th><th className="num">Income / yr</th>
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
                    {r.phase === "boom" ? "expanding" : r.phase === "bust" ? "contracting" : "steady"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="hint">
            {ind.top && ind.top.share > 0.45
              ? `${(ind.top.share * 100).toFixed(0)}% of rent from ${INDUSTRY_LABEL[ind.top.sector].toLowerCase()}. Concentration discounted by buyers and lenders.`
              : "Diversified. Lenders and buyers discount single-industry concentration."}
          </div>
        </div>
      )}

      {/* Which YEAR the leases roll — the chart lived on Portfolio, but the
          roll is this desk's business, so this is its home. */}
      <Rollover />

      <LeasedFeeStrip />

      <div className="page-section">
        <div className="page-section-head">Rent roll</div>
        <div style={{ maxHeight: 420, overflowY: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Property</th>
                <th className="num">sf</th>
                <th className="num">Rent</th>
                <th className="num">Expires</th>
              </tr>
            </thead>
            <tbody>
              {rows.flatMap((r) => r.h.tenants.map((t, i) => ({ t, r, i })))
                .sort((a, b) => a.t.endM - b.t.endM)
                .map(({ t, r, i }) => {
                  const mkt = marketRentPsfYr(r.rec, game.econ, r.h.condition, r.h.condIdx);
                  const d = mkt > 0 ? t.rentPsf / mkt - 1 : 0;
                  const recov = recoveryOf(t);
                  return (
                  <tr key={r.h.bbl + ":" + i} onClick={() => go(r.h.bbl)}>
                    <td>
                      <div><BizLink t={t} /></div>
                      <div className="dim" style={{ fontSize: 11 }}>
                        {t.sector}{t.quality !== undefined ? ` · q${t.quality}` : ""} · {CREDIT_LABEL[t.credit]} · {recov === "nnn" ? "NNN" : recov === "base" ? "base yr" : "gross"}
                        {recov === "base" ? ` · stop $${(t.baseStopPsf ?? 0).toFixed(2)}` : ""}
                      </div>
                    </td>
                    <td className="dim">{r.rec.address}</td>
                    <td className="num">{sf(t.sf)}</td>
                    <td className={"num" + (d < -0.12 ? " neg" : "")}>
                      ${t.rentPsf.toFixed(2)}
                      <div className="dim" style={{ fontSize: 11 }}>{(d * 100).toFixed(0)}% vs mkt</div>
                    </td>
                    <td className={"num" + (t.endM - q <= 12 ? " neg" : "")}>{monthLabel(t.endM)}</td>
                  </tr>
                  );
                })}
              {/* "Nothing under lease yet" sat under a 96%-let apartment
                  building: flats are let unit by unit and carry no named
                  lease, so this table is empty while the rent is real. */}
              {!rows.some((r) => r.h.tenants.length) && (
                <tr><td colSpan={5} className="dim">{totLeased > 0
                  ? `No named leases. ${sf(totLeased)} leased as apartment units (see table above).`
                  : "No leases."}</td></tr>
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

/**
 * ONE MINIMUM NEW LEASE FOR THE WHOLE BOOK. The per-building floor ("Smallest
 * deal you'll sign" on each property) set once for every building you own,
 * and kept as the house default so buildings you buy or deliver later open on
 * it. Each building can still be set apart on its own desk. 0 clears it.
 */
function MinLeaseAll() {
  const game = useStore((s) => s.game)!;
  const house = game.minLeaseDefault ?? 0;
  const [v, setV] = useState<string>(house ? String(house) : "");
  const n = Number(v === "" ? 0 : v);
  const valid = Number.isFinite(n) && n >= 0;
  const changed = valid && Math.round(n) !== house;
  return (
    <label className="buybox-field" title="Minimum new lease size, all buildings and future acquisitions. Renewals, expansions, full-vacancy deals and apartments exempt. Override per building.">
      Min. new lease, all buildings
      <input type="number" step="500" min="0" value={v} placeholder="any"
        style={{ width: 80 }}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && changed) useStore.getState().minLeaseAll(n); }} />sf
      <button type="button" className="btn btn-mini" disabled={!changed}
        onClick={() => useStore.getState().minLeaseAll(n)}>
        {n > 0 ? "Set on all" : "Clear all"}
      </button>
    </label>
  );
}
