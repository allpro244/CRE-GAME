/**
 * THE DESK — the room where the payroll is a decision.
 *
 * The capacity model in engine/staff.ts has been finished and measured for
 * some time and the player could not touch any of it, which is why it shipped
 * pinned to neutral: a penalty with no counterplay is half a feature showing
 * through, not a modelled risk. This page is the counterplay, and flipping
 * HIRING_UI_SHIPPED is the last line of the same change.
 *
 * WHAT THIS PAGE IS ACTUALLY ABOUT.
 *
 * Not payroll arithmetic. Payroll arithmetic is one number and it is on the
 * income statement already. This page is about the thing that makes hiring
 * hard in life and trivial in most games: YOU CANNOT READ THE PERSON. The
 * engine gives every candidate a true ability that is never stated anywhere,
 * an interview impression that is wrong by an amount set by how hard you
 * looked, and a read that converges toward the truth only as months of actual
 * results accumulate. `readAttr` hands back lo/mid/hi, and roughly forty-four
 * points of a hundred separate lo from hi on the day you make the offer.
 *
 * So every attribute on this page is drawn as a RANGE and never as a number.
 * Printing "Cost control 63" would be a lie with a decimal point on it — the
 * engine does not know 63, it knows "somewhere between 41 and 85, and ask me
 * again in a year". The bar narrows as you watch someone work, and watching
 * the bar narrow is the whole feedback loop of the feature. A hire is a bet
 * that resolves over five years.
 *
 * WHAT THE DESK COSTS IS QUOTED AGAINST THE COUNTERFACTUAL, NOT IN THE
 * ABSTRACT.
 *
 * "Load 1.9x" is a diagnostic, not a consequence, and a player reading it has
 * to know the model to know whether to care. So every slip figure on this page
 * is priced by asking the engine the same question twice — once with the desk
 * as it stands, once with `slip` set to zero — and reporting the difference in
 * the units the player already reads: dollars of operating expense a year,
 * renewals that do not happen, prospects who tour the building across the
 * street. Those are calls into pmOpexMult/leasingOddsMult themselves, never a
 * second implementation of them, because a panel that recomputes an engine
 * formula is exactly how one quantity ends up with two answers.
 *
 * ONE THING THIS PANEL DELIBERATELY DOES NOT SHOW: what a named person adds to
 * capacity. Capacity is computed from TRUE urgency and detail, so publishing a
 * per-head contribution would hand back by arithmetic the very number the
 * bands exist to withhold. Candidates get a capacity RANGE derived from the
 * same noisy read the player is looking at; people already on the desk are
 * aggregated.
 */
import { useState } from "react";
import { useStore } from "@/state/store";
import { monthLabel } from "@/engine/types";
import type { GameState } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import {
  ATTR_LABEL, GENERAL_ATTRS, ROLE_LABEL,
  LEASING_BASE_SF, PM_BASE_SF, CONSTRUCTION_BASE_SF, POOL_REFRESH_M, SEARCH_MONTHS,
  SEARCH_TIERS, SEVERANCE_MONTHS, ownerCapacitySf,
  deskBacklog, firmShapeLabel, personRoleState, isFloatStaff,
  leasingOddsMult, leasingRentMult, payrollMonthly, pmRenewalMult, cmRiskMult,
  readAttr, roleState, severanceFor, pmDeskEconomics, salaryYrFor,
  LANDLORD_SIDE_SHARE, IN_HOUSE_MGMT_COST,
  type Candidate, type RoleState, type Staff, type StaffRole,
} from "@/engine/staff";
import { MGMT_FEE } from "@/engine/value";
import { affiliateNetCostMonthly } from "@/engine/sim";
import { firmCapital, firmMilestonesHit, nextFirmMilestone } from "@/engine/firmCapital";
import { PersonCard as PrincipalCard } from "./PersonCard";
import { sf, usd } from "./format";

const ROLES: StaffRole[] = ["pm", "leasing", "construction"];

/** The two attributes each role's CAPACITY is actually a function of. */
const CAPACITY_ATTRS: Record<StaffRole, string[]> = {
  pm: ["urgency", "diligence"],
  leasing: ["urgency", "relationships"],
  construction: ["urgency", "diligence"],
};

/**
 * Firm capital — institutional standing, not XP. Pillars are already-earned
 * quantities (hire name, lenders, exits, bench, vehicle, book).
 */
function FirmCapitalPanel({ game }: { game: GameState }) {
  const fc = firmCapital(game);
  const hit = firmMilestonesHit(game);
  const next = nextFirmMilestone(game);
  const pct = Math.round(fc.score * 100);
  return (
    <div className="page-section">
      <div className="page-section-head">
        Firm capital · {fc.label}
        <span className="dim mono" style={{ marginLeft: 8 }}>tier {fc.tier}/5 · {pct}%</span>
      </div>
      <div className="hint">
        What the firm has earned as an institution: process, name, record. Not a skill build —
        hiring standing, lender file, clean exits, bench, vehicle, and book size.
        It lifts how much construction you can supervise yourself by up to 8% — by{" "}
        {((fc.processCapacityMult - 1) * 100).toFixed(1)}% today.
      </div>
      <div className="grid" style={{ margin: "8px 0" }}>
        {fc.pillars.map((p) => (
          <div key={p.id} style={{ display: "contents" }}>
            <div className="k">{p.label}</div>
            {/* left-aligned so the six bars line up in one column instead of
                starting wherever each sentence's length pushed them */}
            <div className="v mono" title={p.detail} style={{ textAlign: "left" }}>
              <span style={{
                display: "inline-block", width: 100, height: 6,
                background: "rgba(43,37,26,0.12)", borderRadius: 2, verticalAlign: "middle",
                marginRight: 8,
              }}>
                <span style={{
                  display: "block", height: "100%", width: `${Math.round(p.score * 100)}%`,
                  background: "rgba(43,37,26,0.55)", borderRadius: 2,
                }} />
              </span>
              {p.detail}
            </div>
          </div>
        ))}
      </div>
      <div className="hint">
        Milestones {fc.milestonesHit}/{fc.milestonesTotal}
        {hit.length > 0 ? ` · last: ${hit[hit.length - 1]!.label}` : ""}
        {next ? ` · next open: ${next.label}` : " · every chapter marked"}
      </div>
    </div>
  );
}

/**
 * The stat block on every other page is a local component in RightPanel.tsx
 * and is not exported. Rather than reach into that file for one six-line
 * helper, this reuses its CLASSES — same markup, same look, no second
 * stylesheet and nothing to keep in sync but a string.
 */
function Big({ label, value, bad, title }: { label: string; value: string; bad?: boolean; title?: string }) {
  return (
    <div className="big-stat" title={title}>
      <div className="big-label">{label}</div>
      <div className={"big-value mono" + (bad ? " v-bad" : "")}>{value}</div>
    </div>
  );
}

/**
 * THE BAR THAT REFUSES TO BE A NUMBER.
 *
 * A filled bar says "this is how good they are". This one says "the answer is
 * somewhere in here" — a shaded interval on a 1-100 track with a tick at the
 * middle of it — because that is the only honest rendering of a quantity the
 * game itself does not claim to know. The printed figure beside it is the
 * RANGE, never the midpoint: `readAttr` returns a mid, and a player shown a
 * mid will remember it as the answer.
 */
function BandBar({ label, r, hint }: { label: string; r: { mid: number; lo: number; hi: number }; hint?: string }) {
  const lo = Math.max(0, Math.min(100, r.lo));
  const hi = Math.max(0, Math.min(100, r.hi));
  const width = Math.max(1.5, hi - lo);
  return (
    <div className="band" title={hint}>
      <div className="band-head">
        <span className="band-label">{label}</span>
        <span className="band-range mono">{lo}–{hi}</span>
      </div>
      <div className="band-track">
        <div className="band-span" style={{ left: `${lo}%`, width: `${width}%` }} />
        <div className="band-mid" style={{ left: `${Math.max(0, Math.min(100, r.mid))}%` }} />
      </div>
    </div>
  );
}

/**
 * CAPACITY AGAINST WHAT IS ON THE HOOK. The track is scaled to whichever of
 * the two is larger, so the overrun is drawn as an overrun rather than as a
 * full bar — a bar pinned at 100% cannot tell 1.1x from 3x, and those are
 * completely different businesses.
 */
function LoadBar({ rs, inHouse }: { rs: RoleState; inHouse?: boolean }) {
  const span = Math.max(rs.capacity, rs.covered, 1);
  const capPct = (rs.capacity / span) * 100;
  const covPct = (rs.covered / span) * 100;
  const over = rs.covered > rs.capacity;
  return (
    <div className="desk-bar">
      <div className="desk-track">
        <div className="desk-cover" style={{ width: `${Math.min(covPct, capPct)}%` }} />
        {over && (
          <div className="desk-over" style={{ left: `${capPct}%`, width: `${covPct - capPct}%` }} />
        )}
        <div className="desk-cap" style={{ left: `${capPct}%` }} />
      </div>
      <div className="desk-legend">
        <span>{sf(rs.covered)} {inHouse ? "of work" : "on the hook"}</span>
        <span>{sf(rs.capacity)} {inHouse ? "your people can cover — the rest is bought" : "of cover"}</span>
      </div>
    </div>
  );
}

export default function StaffPage() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels);
  const {
    hireStaff, fireStaff, postJob,
    setStaffSearchTier,
    assignStaffBuilding, unassignStaffBuilding,
  } = useStore.getState();
  // Firing is three months of somebody's pay and two months of nobody in the
  // seat. It gets the same arm-then-confirm the "new city" button gets, for
  // the same reason: an irreversible, expensive thing should cost two clicks.
  const [armFire, setArmFire] = useState<number | null>(null);
  if (!parcels) return null;

  const staff = game.staff ?? [];
  const pending = game.pendingHires ?? [];
  const pool = game.hirePool?.list ?? [];
  const posted = game.hirePool?.m ?? -999;
  const poolAge = game.month - posted;
  const stale = !game.hirePool || poolAge >= POOL_REFRESH_M;
  const band = game.hirePool?.band ?? SEARCH_TIERS[0].band;
  const tier = SEARCH_TIERS.find((t) => t.band === band) ?? SEARCH_TIERS[0];
  const payroll = payrollMonthly(game);
  const ownerCover = ownerCapacitySf(game, "construction");
  const affiliateNet = affiliateNetCostMonthly(game);
  // Buildings you operate — leased fees are coupon paper, not a desk assignment.
  const ownedBbls = Object.keys(game.holdings).filter((b) => !game.holdings[b].groundLeased);
  // Live jobs for construction assignment.
  const jobBbls = Object.keys(game.developments ?? {}).filter((b) => {
    const d = game.developments![b];
    return d && d.deliverM > game.month;
  });
  const costIdx = game.econ.costIdx ?? 1;
  const rep = game.hireReputation ?? 0.55;
  const shape = firmShapeLabel(game);

  return (
    <div>
      <div className="stat-strip">
        <Big
          label="Payroll / mo"
          value={payroll ? usd(payroll) : "—"}
          title="Salaries are agreed in year-2000 dollars and billed at today's price level, like every other cost in this game. A wage that ignores inflation is free money by year sixty."
        />
        <Big label="On the desk" value={String(staff.length)} />
        <Big
          label="Working out notice"
          value={pending.length ? String(pending.length) : "—"}
          title={pending.map((p) => `${p.staff.name} starts ${monthLabel(p.startM)}`).join(" · ") || undefined}
        />
        <Big
          label="Mgmt co. / mo"
          value={affiliateNet ? (affiliateNet < 0 ? "+" : "−") + usd(Math.abs(affiliateNet)) : "—"}
          bad={affiliateNet > 0}
          title="Your own management company, last month: the 4% fees it collected from the buildings your property managers cover, less its back office. Salaries are in payroll. Netted into G&A."
        />
        <Big
          label="You supervise"
          value={sf(ownerCover)}
          title="How much live construction you can watch yourself before jobs go unsupervised. Bandwidth and firm shape move it; a construction manager adds to it."
        />
      </div>

      <div className="hint">
        {staff.some((x) => x.role === "leasing") && !game.teamLeasing && !game.agent
          ? "Your leasing hires are on payroll and signing nothing: the pen is still yours until you hand it to them on the Leasing desk. "
          : ""}
        {`With nobody hired, the work is bought: an outside manager at ${(MGMT_FEE * 100).toFixed(0)}% of collections, outside brokers on commission, and you on your own construction jobs. `
          + "A hire takes as much of that in-house as they have hours for — the fee stops leaving the firm, the salary starts. What they cannot cover stays outside; only construction slips. "}
        {rep < 0.45 ? " The street remembers messy firings — the next shortlist will read worse." : ""}
      </div>

      <div className="page-section">
        <div className="page-section-head">Firm shape · {shape}</div>
        <div className="hint">
          Shape emerges from headcount — a one-person shop is hands-on and boutique; a larger payroll reads as a platform.
          Capacity arithmetic follows the org chart; there is no free dial to force it.
        </div>
      </div>

      <FirmCapitalPanel game={game} />

      {game.principal && (
        <PrincipalCard person={game.principal} game={game} showAttrs title="You · the principal" />
      )}

      {ROLES.map((role) => (
        <RoleDesk
          key={role}
          role={role}
          rs={roleState(game, parcels, role)}
          backlog={deskBacklog(game, parcels, role)}
          staff={staff.filter((x) => x.role === role)}
          pending={pending.filter((p) => p.staff.role === role)}
          month={game.month}
          ownedBbls={ownedBbls}
          jobBbls={jobBbls}
          parcels={parcels}
          game={game}
          onFire={(id) => {
            if (armFire !== id) { setArmFire(id); setTimeout(() => setArmFire(null), 5000); return; }
            setArmFire(null);
            fireStaff(id);
          }}
          onAssign={(id, bbl) => assignStaffBuilding(id, bbl)}
          onUnassign={(id, bbl) => unassignStaffBuilding(id, bbl)}
          armed={armFire}
          severance={(st) => severanceFor(game, st)}
        />
      ))}

      <div className="page-section">
        <div className="page-section-head">
          The shortlist{game.hirePool ? ` · posted ${monthLabel(posted)}` : ""}
        </div>
        <div className="hint">
          {tier.label === SEARCH_TIERS[0].label
            ? "These names came off a posted job, which is the cheapest look there is and reads accordingly: "
            : `These names came through ${tier.label.toLowerCase()}, so the first impression is tighter than a posted job would give: `}
          about ±{band} points of a hundred before the role's own difficulty is applied, and the difficulties are
          not equal. A room reads presence and negotiation accurately and detail orientation barely at all,
          which is the entire reason bad hires happen to careful people. Every ask is firm, agreed in
          year-2000 dollars and billed at today's price level — the industry has been watching these people
          work for a decade even though you have not.
          {!stale && ` A fresh list goes up in ${POOL_REFRESH_M - poolAge} month${POOL_REFRESH_M - poolAge === 1 ? "" : "s"} — a hiring market that reshuffles on demand is a slot machine, and the decision it produces is "spin again" rather than "is this person worth the money".`}
        </div>
        <div className="btn-row" style={{ marginTop: 8 }}>
          {SEARCH_TIERS.map((t) => {
            const cost = Math.round(t.cost * costIdx);
            const on = tier.key === t.key;
            return (
              <button
                key={t.key}
                type="button"
                className={"btn" + (on ? " btn-on" : "")}
                disabled={!stale && on}
                title={cost ? `${usd(cost)} at today's prices · band ±${t.band}` : `Free · band ±${t.band}`}
                onClick={() => setStaffSearchTier(t.key)}
              >
                {t.label}{cost ? ` · ${usd(cost)}` : ""}
              </button>
            );
          })}
          {stale && !game.hirePool && (
            <button className="btn" onClick={() => postJob()}>Post the first list</button>
          )}
        </div>
        {ROLES.map((role) => {
          const cands = pool.filter((c) => c.role === role);
          return (
            <div key={role} className="cand-group">
              <div className="cand-group-head">{ROLE_LABEL[role]}</div>
              {cands.length ? (
                <div className="cand-grid">
                  {cands.map((c) => (
                    <CandidateCard
                      key={c.id}
                      c={c}
                      costIdx={game.econ.costIdx ?? 1}
                      cash={game.cash}
                      month={game.month}
                      onHire={() => hireStaff(c.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="hint">
                  {!game.hirePool
                    ? "The job has not gone out yet."
                    : "Nobody left on this list — you took them, or nobody applied."}
                  {!stale && ` The next one is posted in ${POOL_REFRESH_M - poolAge} month${POOL_REFRESH_M - poolAge === 1 ? "" : "s"}.`}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * ONE SEAT, PRICED.
 *
 * PM and leasing are read as a make-or-buy decision: how much of the book is
 * in-house, what that saves against the outside firm, what the salary costs,
 * and what the people in the seat are worth on top. Construction is read as
 * load: past the cover of whoever is watching, site risk runs hotter. Every
 * figure is a call into the engine function the simulation runs — nothing
 * here re-derives a multiplier.
 */
function RoleDesk({ role, rs, backlog, staff, pending, month, ownedBbls, jobBbls, parcels, game, onFire, onAssign, onUnassign, armed, severance }: {
  role: StaffRole;
  rs: RoleState;
  backlog: ReturnType<typeof deskBacklog>;
  staff: Staff[];
  pending: { staff: Staff; startM: number }[];
  month: number;
  ownedBbls: string[];
  jobBbls: string[];
  parcels: ParcelTable;
  game: GameState;
  onFire: (id: number) => void;
  onAssign: (id: number, bbl: string) => void;
  onUnassign: (id: number, bbl: string) => void;
  armed: number | null;
  severance: (st: Staff) => number;
}) {
  const covered: RoleState = { ...rs, slip: 0 };
  const lines: { text: string; bad: boolean }[] = [];
  const manned = staff.length > 0;
  const one = staff.length === 1;
  const who = !manned ? "You, doing this yourself," : one ? staff[0].name : "The people in this seat";
  const runs = manned && one ? "runs" : "run";
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const inHouse = role !== "construction";
  let head = "";

  if (role === "pm") {
    const ec = pmDeskEconomics(game, parcels);
    head = rs.covered > 0 ? `${pct(rs.share)} in-house` : "no buildings";
    if (!manned) {
      lines.push({
        bad: false,
        text: ec.outsideFeeYr > 0
          ? `A third-party manager runs every building for the ${(MGMT_FEE * 100).toFixed(0)}% fee — ${usd(ec.outsideFeeYr)} a year at today's collections. `
            + `A property manager of yours takes that in-house on as much as they can cover: the fee comes to your own management company, which carries a back office of about ${(IN_HOUSE_MGMT_COST * 100).toFixed(1)}% of collections, and the salary.`
          : "No buildings to manage. A property manager is a salary against nothing until you own some.",
      });
    } else {
      lines.push({
        bad: ec.netYr < 0,
        text: `Fees kept ${usd(ec.feeKeptYr)} − back office ${usd(ec.backOfficeYr)}`
          + (Math.abs(ec.opexSavedYr) > 1 ? ` ${ec.opexSavedYr >= 0 ? "+" : "−"} operating cost ${ec.opexSavedYr >= 0 ? "saved" : "added"} ${usd(Math.abs(ec.opexSavedYr))}` : "")
          + ` − salaries ${usd(ec.salaryYr)} = ${ec.netYr >= 0 ? "" : "−"}${usd(Math.abs(ec.netYr))} a year against leaving it all with the outside firm.`
          + (ec.netYr < 0 && rs.share >= 0.999
            ? (rs.covered > 0 ? " The book is too small to carry the seat yet." : " There are no buildings for them to run yet.")
            : ""),
      });
      if (backlog.outsideSf > 0 && ec.outsideFeeYr > 0) {
        lines.push({
          bad: false,
          text: `${sf(backlog.outsideSf)} of the load is past what your people can cover and stays with the outside manager — ${usd(ec.outsideFeeYr)} a year in fees still leaving the firm. Another hire, or pinning, moves it.`,
        });
      }
      const kept = rs.skill;
      if (rs.covered > 0 && Math.abs(kept - 50) >= 3) {
        const renew = pmRenewalMult(covered);
        lines.push({
          bad: kept < 50,
          text: kept > 50
            ? `${who} ${runs} the covered buildings better than the outside firm did — tighter contracts, systems on schedule — and tenants renew about ${((renew - 1) * 100).toFixed(0)}% more readily where they are on the file.`
            : `${who} ${runs} the covered buildings worse than the outside firm did, and tenants renew about ${((1 - renew) * 100).toFixed(0)}% less readily there. The fee you kept is paying for it.`,
        });
      }
    }
  } else if (role === "leasing") {
    head = rs.covered > 0 ? `${pct(rs.share)} in-house` : "no commercial space";
    if (!manned || rs.covered <= 0) {
      lines.push({
        bad: false,
        text: rs.covered > 0
          ? `Outside brokers work your commercial space and take the full commission — 4% of a new lease, 2% of a renewal — split with the tenant's broker. `
            + `A leasing hire is the landlord's side: on what they cover, that half (${pct(LANDLORD_SIDE_SHARE)}) is not paid, and how good they are moves tours and rent from there. Apartments let themselves and are not on this desk.`
          : manned
            ? "No commercial space to lease, so this seat has nothing to cover yet. Apartments let themselves."
            : "No commercial space to lease. Apartments let themselves.",
      });
    } else {
      const sal = salaryYrFor(game, "leasing");
      lines.push({
        bad: false,
        text: `On ${pct(rs.share)} of your commercial space the landlord half of every commission stays in the firm — 2% instead of 4% on a new lease, 1% instead of 2% on a renewal. `
          + `Against ${usd(sal)} a year in salaries, that pays when the book is turning over: it is a seat that earns per deal, not per foot.`,
      });
      if (backlog.outsideSf > 0) {
        lines.push({
          bad: false,
          text: `${sf(backlog.outsideSf)} is past what your leasing people can cover and is still worked by outside brokers at the full commission.`,
        });
      }
      const odds = leasingOddsMult(covered);
      const rent = leasingRentMult(covered);
      if (Math.abs(odds - 1) > 0.005) {
        lines.push({
          bad: odds < 1,
          text: odds > 1
            ? `${who} ${runs} about ${((odds - 1) * 100).toFixed(0)}% more prospects through covered buildings than outside brokers turn up, and sign about ${((rent - 1) * 100).toFixed(1)}% over market. A leasing team does not create tenants — it changes how many tour YOUR building.`
            : `${who} turn${one ? "s" : ""} up about ${((1 - odds) * 100).toFixed(0)}% fewer prospects than the outside brokers would have, and sign about ${((1 - rent) * 100).toFixed(1)}% under market.`,
        });
      }
    }
  } else {
    const now = cmRiskMult(rs);
    const kept = cmRiskMult(covered);
    head = rs.covered > 0
      ? `${rs.load.toFixed(2)}× cover${rs.slip > 0 ? ` · ${pct(rs.slip)} unsupervised` : " · keeping up"}`
      : "nothing in the ground";
    if (rs.covered <= 0) {
      lines.push({
        bad: false,
        text: manned
          ? `Nothing is under construction, so this seat is being paid to wait. That is a real decision and sometimes the right one — a manager you let go is a search and two months of nobody before the next job starts — but it is overhead against no work.`
          : `Nothing under construction. There is no work for this seat until you break ground.`,
      });
    }
    if (backlog.uncoveredN > 0) {
      lines.push({
        bad: true,
        text: `${backlog.uncoveredN} live job${backlog.uncoveredN === 1 ? "" : "s"} (${sf(backlog.uncoveredSf)}) sit on you alone — every construction hire is pinned elsewhere.`,
      });
    }
    if (now - kept > 0.005) {
      lines.push({
        bad: true,
        text: `At ${rs.load.toFixed(2)}× the cover of whoever is watching, jobs run ${((now / kept - 1) * 100).toFixed(0)}% more site risk — `
          + `change orders nobody scoped, subs nobody pre-qualified, inspections failed in the week nobody was there.`
          + (backlog.unsupervisedJobSf > 0 ? ` ${sf(backlog.unsupervisedJobSf)} of live work is effectively unsupervised.` : ""),
      });
    }
    if (rs.covered > 0 && Math.abs(kept - 1) > 0.005) {
      lines.push({
        bad: kept > 1,
        text: kept < 1
          ? `${who} ${runs} about ${((1 - kept) * 100).toFixed(0)}% fewer change orders, weather slips and subcontractor defaults than an ordinary job carries, and the ones that land are that much smaller. It is preconstruction and being on site — it does not make steel cheaper and it will not save a job the market has repriced.`
          : `${who} ${runs} about ${((kept - 1) * 100).toFixed(0)}% MORE site risk than an ordinary owner's representative would, before any overload. That is who is watching the work.`,
      });
    }
  }

  const base = role === "pm" ? PM_BASE_SF : role === "construction" ? CONSTRUCTION_BASE_SF : LEASING_BASE_SF;

  return (
    <div className="page-section">
      <div className={"page-section-head" + (rs.slip > 0.15 && !inHouse ? " neg" : "")}>
        {ROLE_LABEL[role]} · {head}
      </div>
      <LoadBar rs={rs} inHouse={inHouse} />
      <div className="hint">
        {role === "pm"
          ? `A manager covers about ${sf(base)} of commercial at ordinary ability, and apartments eat that faster per foot than anything else — a hundred flats is a hundred tenancies where a hundred thousand feet of warehouse is one.`
          : role === "construction"
            ? `An owner's representative carries about ${sf(base)} of LIVE CONSTRUCTION at ordinary ability — two or three concurrent jobs — on top of what you can watch yourself. This seat is loaded by what is in the ground and not by what is standing. They cost what they cost either way, so this is a seat you fill when you are building and let go when you are not.`
            : `A leasing desk covers about ${sf(base)} of commercial at ordinary ability. Flats are not on this list at all: multifamily lets itself, and the engine has always said so.`}
      </div>
      {lines.length > 0 && (
        <div className="desk-lines">
          {lines.map((l, i) => (
            <div key={i} className={"desk-line" + (l.bad ? " desk-line-bad" : "")}>{l.text}</div>
          ))}
        </div>
      )}

      {pending.map((p) => (
        <div key={p.staff.id} className="staff-row staff-pending">
          <div>
            <div className="staff-name">{p.staff.name}</div>
            <div className="staff-sub">
              Accepted. Working out notice — starts {monthLabel(p.startM)}, {Math.max(0, p.startM - month)} month
              {Math.max(0, p.startM - month) === 1 ? "" : "s"} from now. The seat is not covered until they walk in.
            </div>
          </div>
          <div className="staff-actions dim mono">{usd(p.staff.salary)}<span className="dim"> / yr, yr-2000</span></div>
        </div>
      ))}

      {staff.map((st) => (
        <PersonCard
          key={st.id}
          st={st}
          month={month}
          severance={severance(st)}
          armed={armed === st.id}
          ownedBbls={ownedBbls}
          jobBbls={jobBbls}
          parcels={parcels}
          game={game}
          onFire={() => onFire(st.id)}
          onAssign={(bbl) => onAssign(st.id, bbl)}
          onUnassign={(bbl) => onUnassign(st.id, bbl)}
        />
      ))}
    </div>
  );
}

/**
 * SOMEBODY YOU ALREADY EMPLOY.
 *
 * The bands here are the same bands the shortlist showed, months later, and
 * that is the point of drawing them the same way: an attribute you read as
 * "somewhere between 31 and 79" at the interview reads "between 58 and 66" by
 * the third year, because the opex ratio and the renewal rate came in and you
 * have been inferring from them the whole time — which is exactly how you find
 * out about a person in life. Nothing here ever prints the true number,
 * because nothing in life does either.
 */
function PersonCard({ st, month, severance, armed, ownedBbls, jobBbls, parcels, game, onFire, onAssign, onUnassign }: {
  st: Staff; month: number; severance: number; armed: boolean;
  ownedBbls: string[]; jobBbls: string[]; parcels: ParcelTable; game: GameState;
  onFire: () => void;
  onAssign: (bbl: string) => void;
  onUnassign: (bbl: string) => void;
}) {
  const served = Math.max(0, month - st.hiredM);
  const keys = [...GENERAL_ATTRS];
  const rigor = game.principal?.attrs?.diligence ?? 50;
  const widthNow = keys.reduce((a, k) => { const r = readAttr(st, k, month, rigor); return a + (r.hi - r.lo); }, 0) / keys.length;
  const widthHire = keys.reduce((a, k) => { const r = readAttr(st, k, st.hiredM, rigor); return a + (r.hi - r.lo); }, 0) / keys.length;
  const assignTargets = st.role === "construction" ? jobBbls : ownedBbls;
  const assigned = st.assignedBbls ?? [];
  const freeBbls = assignTargets.filter((b) => !assigned.includes(b));
  const floating = isFloatStaff(st);
  const personal = !floating ? personRoleState(game, parcels, st) : null;
  return (
    <div className="staff-row">
      <div className="staff-main">
        <div className="staff-name">{st.name}</div>
        <div className="staff-sub">
          {ROLE_LABEL[st.role]} since {monthLabel(st.hiredM)} · {(served / 12).toFixed(1)} years watched ·{" "}
          {usd(st.salary)} / yr in year-2000 dollars
          {floating
            ? " · float desk (covers what is not pinned)"
            : personal
              ? ` · on the hook for ${sf(personal.covered)} at ${personal.load.toFixed(2)}× their cover`
              : ""}
        </div>
        <div className="band-grid">
          {keys.map((k) => (
            <BandBar
              key={k}
              label={ATTR_LABEL[k] ?? k}
              r={readAttr(st, k, month, rigor)}
              hint="What the results so far suggest. The true figure is never stated — you infer it, the way you would."
            />
          ))}
        </div>
        <div className="hint">
          {served < 6
            ? "Too early to tell. You bought the interview; the results have not arrived yet."
            : `Your read has tightened from about ${widthHire.toFixed(0)} points wide at the interview to ${widthNow.toFixed(0)}. Rigor shortens how long that takes — twelve months of results still halve a mid read.`}
        </div>
        <div className="staff-assign">
          <div className="hint">
            {st.role === "construction"
              ? "Pin them to a live job and that site is their load. Leave them floating and they cover every unassigned job with you."
              : "Pin them to a building and that asset is their load. Leave them floating and they cover the unassigned remainder; whatever nobody covers stays with the outside firm."}
          </div>
          {assigned.length > 0 && (
            <div className="btn-row" style={{ marginTop: 6 }}>
              {assigned.map((bbl) => {
                const addr = parcels[bbl]?.address ?? bbl;
                const label = st.role === "construction" ? `${addr} · job · clear` : `${addr} · clear`;
                return (
                  <button key={bbl} type="button" className="btn btn-on" onClick={() => onUnassign(bbl)} title="Clear this assignment">
                    {label}
                  </button>
                );
              })}
            </div>
          )}
          {freeBbls.length > 0 && (
            <label className="staff-assign-pick">
              <span className="dim">{st.role === "construction" ? "Put on job" : "Put on"}</span>
              <select
                defaultValue=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) onAssign(v);
                  e.target.value = "";
                }}
              >
                <option value="">{st.role === "construction" ? "a live job…" : "a building…"}</option>
                {freeBbls.map((bbl) => (
                  <option key={bbl} value={bbl}>
                    {parcels[bbl]?.address ?? bbl}
                    {st.role === "construction" && game.developments?.[bbl]
                      ? ` · ${sf(game.developments[bbl].sf)}`
                      : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {st.role === "construction" && jobBbls.length === 0 && (
            <div className="hint">Nothing in the ground — there is no job to assign them to.</div>
          )}
        </div>
      </div>
      <div className="staff-actions">
        <button className={"btn btn-danger" + (armed ? " btn-on" : "")} onClick={onFire}>
          {armed ? `Pay ${usd(severance)} and empty the seat?` : "Let them go"}
        </button>
        <div className="staff-cost">
          {SEVERANCE_MONTHS} months' severance — {usd(severance)} today — and then {SEARCH_MONTHS} months before a
          replacement can start, because a search takes a search and the person you hire is working out a notice.
          Your cover falls the moment you decide it was inadequate. That gap is the real price of this button.
          Early exits also sour the next shortlist.
        </div>
      </div>
    </div>
  );
}

/**
 * A NAME, A PRICE, AND SIX THINGS YOU DO NOT KNOW ABOUT THEM.
 *
 * The ask is quoted in today's money because that is the cheque you write;
 * the year-2000 figure is beside it because that is what the contract says and
 * what it will still say in forty years when the price level has moved five
 * times. The capacity preview is a RANGE, derived from the same read shown
 * below it — the true figure would tell the player the answer to the question
 * this entire screen exists to withhold.
 */
function CandidateCard({ c, costIdx, cash, month, onHire }: {
  c: Candidate; costIdx: number; cash: number; month: number; onHire: () => void;
}) {
  const askToday = c.askSalary * costIdx;
  const firstMonth = Math.round(askToday / 12);
  const keys = [...GENERAL_ATTRS];
  const base = c.role === "pm" ? PM_BASE_SF : c.role === "construction" ? CONSTRUCTION_BASE_SF : LEASING_BASE_SF;
  // The capacity a person adds is 0.6x-1.5x of the role's base, set by the two
  // attributes in CAPACITY_ATTRS — so the honest preview is that formula run
  // on the bottom and the top of what the interview can tell you.
  const capKeys = CAPACITY_ATTRS[c.role];
  const capLo = capKeys.reduce((a, k) => a + readAttr(c, k, month).lo, 0) / capKeys.length;
  const capHi = capKeys.reduce((a, k) => a + readAttr(c, k, month).hi, 0) / capKeys.length;
  const coverLo = base * (0.6 + (capLo / 100) * 0.9);
  const coverHi = base * (0.6 + (capHi / 100) * 0.9);
  const afford = cash >= firstMonth;
  return (
    <div className="cand">
      <div className="cand-head">
        <span className="cand-name">{c.name}</span>
        <span className="cand-ask mono">{usd(askToday)}<span className="dim"> / yr</span></span>
      </div>
      {/* The why of the number lives once, in the shortlist's hint; nine
          cards repeating the same two sentences was the longest text on the page. */}
      <div className="cand-sub" title="Salaries are agreed in year-2000 dollars and billed at today's price level. Candidates do not take less than their ask.">
        {usd(c.askSalary)} a year in year-2000 dollars · firm ask
      </div>
      <div className="band-grid">
        {keys.map((k) => (
          <BandBar
            key={k}
            label={ATTR_LABEL[k] ?? k}
            r={readAttr(c, k, month)}
            hint="An interview and two references. The band narrows only once they are working for you."
          />
        ))}
      </div>
      <div className="cand-cover">
        Would cover somewhere between {sf(coverLo)} and {sf(coverHi)} — a spread of {sf(coverHi - coverLo)},
        which is the size of the bet.
      </div>
      <div className="btn-row">
        <button className="btn btn-buy" onClick={onHire} disabled={!afford}>
          {afford ? `Make the offer · ${usd(firstMonth)} / mo` : `Need ${usd(firstMonth)} for the first month`}
        </button>
      </div>
      <div className="cand-note">
        They give notice and start in {SEARCH_MONTHS} months. Nothing is covered in the meantime.
      </div>
    </div>
  );
}
