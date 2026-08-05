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
  ATTR_LABEL, GENERAL_ATTRS, ROLE_ATTRS, ROLE_LABEL,
  LEASING_BASE_SF, OWNER_SF, PM_BASE_SF, POOL_REFRESH_M, SEARCH_MONTHS,
  SEARCH_TIERS, SEVERANCE_MONTHS,
  leasingOddsMult, leasingRentMult, payrollMonthly, pmOpexMult, pmRenewalMult,
  readAttr, roleState, severanceFor,
  type Candidate, type RoleState, type Staff, type StaffRole,
} from "@/engine/staff";
import { operatingStatement, resolveRec } from "@/engine/value";
import { sf, usd } from "./format";

const ROLES: StaffRole[] = ["pm", "leasing"];

/** The two attributes each role's CAPACITY is actually a function of. */
const CAPACITY_ATTRS: Record<StaffRole, string[]> = {
  pm: ["urgency", "diligence"],
  leasing: ["urgency", "relationships"],
};

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
function LoadBar({ rs }: { rs: RoleState }) {
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
        <span>{sf(rs.covered)} on the hook</span>
        <span>{sf(rs.capacity)} of cover</span>
      </div>
    </div>
  );
}

/**
 * WHAT THE FIRM'S OPERATING EXPENSE WOULD BE UNDER AN ORDINARY, UNSTRETCHED
 * DESK — the base every management figure on this page is quoted against.
 *
 * It divides the bill each building is ACTUALLY running by the multiplier that
 * was stamped on it, rather than re-deriving an expense stack here. That
 * matters: `operatingStatement` already knows about service level, completed
 * systems programmes, the class of the building and the price level, and a
 * second opinion assembled in a panel would disagree with the statement on the
 * property page the first time any of those changed.
 */
function neutralOpexYr(game: GameState, parcels: ParcelTable): number {
  let total = 0;
  for (const h of Object.values(game.holdings)) {
    const rec = resolveRec(parcels, game, h.bbl);
    if (!rec || rec.class === "land" || !rec.bldgArea) continue;
    const os = operatingStatement(rec, game.econ, h, game.month);
    total += os.opex / (h.pmOpexMult ?? 1);
  }
  return total;
}

export default function StaffPage() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels);
  const { hireStaff, fireStaff, postJob } = useStore.getState();
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
  const opexBase = neutralOpexYr(game, parcels);

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
          label="You cover, alone"
          value={sf(OWNER_SF)}
          title="The firm starts as one person who is also underwriting, financing and walking buildings. About six small buildings' worth — and you never stop counting toward the desk, whoever else is on it."
        />
      </div>

      <div className="hint">
        {staff.length
          ? "One person covers a certain amount of property and no more, and you are still one of them. "
          : "Nobody is managing your buildings but you, and one person covers a certain amount of property and no more. "}
        Past capacity the roof inspection slips, the renewal conversation happens two months late, and the
        vendor contract rolls over unexamined. None of that is a penalty applied to you — it is work that did
        not get done, priced below in the units it costs you.
      </div>

      {ROLES.map((role) => (
        <RoleDesk
          key={role}
          role={role}
          rs={roleState(game, parcels, role)}
          opexBase={opexBase}
          staff={staff.filter((x) => x.role === role)}
          pending={pending.filter((p) => p.staff.role === role)}
          month={game.month}
          onFire={(id) => {
            if (armFire !== id) { setArmFire(id); setTimeout(() => setArmFire(null), 5000); return; }
            setArmFire(null);
            fireStaff(id);
          }}
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
          which is the entire reason bad hires happen to careful people.
          {!stale && ` A fresh list goes up in ${POOL_REFRESH_M - poolAge} month${POOL_REFRESH_M - poolAge === 1 ? "" : "s"} — a hiring market that reshuffles on demand is a slot machine, and the decision it produces is "spin again" rather than "is this person worth the money".`}
        </div>
        {stale && (
          <div className="btn-row">
            <button className="btn" onClick={() => postJob()}>
              {game.hirePool ? "Post the job again" : "Post the job"}
            </button>
          </div>
        )}
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
 * The load ratio is the diagnostic and the three lines under it are the
 * consequence. Each one asks the engine what it would do with this same desk
 * if it were not over capacity — `{...rs, slip: 0}` through the very function
 * the simulation runs — and reports the gap. Nothing here re-derives a
 * multiplier, so this panel and the operating statement on the property page
 * cannot drift apart.
 */
function RoleDesk({ role, rs, opexBase, staff, pending, month, onFire, armed, severance }: {
  role: StaffRole;
  rs: RoleState;
  opexBase: number;
  staff: Staff[];
  pending: { staff: Staff; startM: number }[];
  month: number;
  onFire: (id: number) => void;
  armed: number | null;
  severance: (st: Staff) => number;
}) {
  const covered: RoleState = { ...rs, slip: 0 };
  const lines: { text: string; bad: boolean }[] = [];
  // WHO IS ACTUALLY DOING THIS. With nobody hired the seat is you, and the
  // engine floors your competence a little under a professional desk's — so
  // every "worse than ordinary" line below has to name the right person or it
  // reads as the game insulting an employee who does not exist.
  const manned = staff.length > 0;
  const one = staff.length === 1;
  const who = !manned ? "You, doing this yourself," : one ? staff[0].name : "The people in this seat";
  const isAre = manned && one ? "is" : "are";
  const runs = manned && one ? "runs" : "run";
  const turns = manned && one ? "turns" : "turn";

  if (role === "pm") {
    const now = pmOpexMult(rs);
    const kept = pmOpexMult(covered);
    const slipCost = opexBase * (now - kept);
    const skillWorth = opexBase * (1 - kept);
    if (slipCost > 0) {
      lines.push({
        bad: true,
        text: `Being ${(rs.load).toFixed(2)}× over the line adds ${((now / kept - 1) * 100).toFixed(1)}% to what your buildings cost to run`
          + (opexBase > 0 ? ` — ${usd(slipCost)} a year of operating expense you would not otherwise be paying.` : "."),
      });
    }
    if (Math.abs(skillWorth) > 1) {
      lines.push({
        bad: skillWorth < 0,
        text: skillWorth > 0
          ? `${who} ${isAre} worth ${usd(skillWorth)} a year against an ordinary desk — contracts examined, systems on a schedule, vendors who know somebody is reading the invoice.`
          : manned
            ? `${who} ${runs} the buildings ${usd(-skillWorth)} a year DEARER than an ordinary desk would. That is not the load; that is who is doing the work.`
            : `Running them yourself costs about ${usd(-skillWorth)} a year more than a competent manager would — you are underwriting and financing at the same time, and it shows in the invoices nobody reads.`,
      });
    }
    const renew = pmRenewalMult(rs);
    const renewKept = pmRenewalMult(covered);
    if (renewKept - renew > 0.005) {
      lines.push({
        bad: true,
        text: `Renewal conversations happen ${((1 - renew / renewKept) * 100).toFixed(0)}% less often than they would if the same people were inside capacity. `
          + `Every one of those is a tenant who quietly went to market instead of signing again.`,
      });
    } else if (renew > 1.005) {
      lines.push({ bad: false, text: `Tenants renew about ${((renew - 1) * 100).toFixed(0)}% more readily than standard — somebody is having the conversation early.` });
    }
  } else {
    const odds = leasingOddsMult(rs);
    const oddsKept = leasingOddsMult(covered);
    if (oddsKept - odds > 0.005) {
      lines.push({
        bad: true,
        text: `You are seeing ${((1 - odds / oddsKept) * 100).toFixed(0)}% fewer prospects than this same desk would inside its capacity. `
          + `The tenants still exist; they are touring the building across the street because nobody returned the call.`,
      });
    }
    if (Math.abs(oddsKept - 1) > 0.005) {
      lines.push({
        bad: oddsKept < 1,
        text: oddsKept > 1
          ? `Deal flow ${manned ? "they" : "you"} created rather than waited for: ${((oddsKept - 1) * 100).toFixed(0)}% more prospects through the door than an ordinary desk turns up. A leasing team does not change how many tenants exist in this city — it changes how many of them tour YOUR building instead of the one across the street.`
          : manned
            ? `${who} ${turns} up ${((1 - oddsKept) * 100).toFixed(0)}% fewer prospects than an ordinary desk would.`
            : `Answering your own phone turns up about ${((1 - oddsKept) * 100).toFixed(0)}% fewer prospects than a leasing desk would. Nobody is calling the brokers back on your behalf.`,
      });
    }
    const rent = leasingRentMult(rs);
    if (Math.abs(rent - 1) > 0.002) {
      lines.push({
        bad: rent < 1,
        text: rent > 1
          ? `Rents signed from here run about ${((rent - 1) * 100).toFixed(1)}% over market — somebody who knows what the last comparable actually cleared at. It applies to what you sign next, not to the leases already in place.`
          : `Rents signed from here run about ${((1 - rent) * 100).toFixed(1)}% under market. It applies to what you sign next, not to the leases already in place.`,
      });
    }
  }

  const base = role === "pm" ? PM_BASE_SF : LEASING_BASE_SF;

  return (
    <div className="page-section">
      <div className={"page-section-head" + (rs.slip > 0.15 ? " neg" : "")}>
        {ROLE_LABEL[role]} · {rs.load.toFixed(2)}× capacity
        {rs.slip > 0 ? ` · ${(rs.slip * 100).toFixed(0)}% of the work slipping` : " · keeping up"}
      </div>
      <LoadBar rs={rs} />
      <div className="hint">
        {role === "pm"
          ? `A manager covers about ${sf(base)} of commercial at ordinary ability, and apartments eat that faster per foot than anything else — a hundred flats is a hundred tenancies where a hundred thousand feet of warehouse is one.`
          : `A leasing desk covers about ${sf(base)} of commercial at ordinary ability. Flats are not on this list at all: multifamily lets itself, and the engine has always said so.`}
      </div>
      {lines.length > 0 && (
        <div className="desk-lines">
          {lines.map((l, i) => (
            <div key={i} className={"desk-line" + (l.bad ? " desk-line-bad" : "")}>{l.text}</div>
          ))}
        </div>
      )}
      {rs.slip === 0 && !staff.length && (
        <div className="hint">
          You are inside your own cover and the buildings are not suffering for it. A salary against a book this
          size is money spent to fix something that is not broken yet.
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
          onFire={() => onFire(st.id)}
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
function PersonCard({ st, month, severance, armed, onFire }: {
  st: Staff; month: number; severance: number; armed: boolean; onFire: () => void;
}) {
  const served = Math.max(0, month - st.hiredM);
  const keys = [...GENERAL_ATTRS, ...ROLE_ATTRS[st.role]];
  const widthNow = keys.reduce((a, k) => { const r = readAttr(st, k, month); return a + (r.hi - r.lo); }, 0) / keys.length;
  const widthHire = keys.reduce((a, k) => { const r = readAttr(st, k, st.hiredM); return a + (r.hi - r.lo); }, 0) / keys.length;
  return (
    <div className="staff-row">
      <div className="staff-main">
        <div className="staff-name">{st.name}</div>
        <div className="staff-sub">
          {ROLE_LABEL[st.role]} since {monthLabel(st.hiredM)} · {(served / 12).toFixed(1)} years watched ·{" "}
          {usd(st.salary)} / yr in year-2000 dollars
        </div>
        <div className="band-grid">
          {keys.map((k) => (
            <BandBar
              key={k}
              label={ATTR_LABEL[k] ?? k}
              r={readAttr(st, k, month)}
              hint="What the results so far suggest. The true figure is never stated — you infer it, the way you would."
            />
          ))}
        </div>
        <div className="hint">
          {served < 6
            ? "Too early to tell. You bought the interview; the results have not arrived yet."
            : `Your read has tightened from about ${widthHire.toFixed(0)} points wide at the interview to ${widthNow.toFixed(0)}. Twelve months of results halve the error and five years all but remove it.`}
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
  const keys = [...GENERAL_ATTRS, ...ROLE_ATTRS[c.role]];
  const base = c.role === "pm" ? PM_BASE_SF : LEASING_BASE_SF;
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
      <div className="cand-sub">
        {usd(c.askSalary)} a year in year-2000 dollars, billed at today's price level. They will not take less —
        the rest of the industry has been watching them work for a decade even though you have not.
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
