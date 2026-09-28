import { useEffect } from "react";
import { useStore } from "@/state/store";
import { yearReview, ordinal, careerCard } from "@/engine/standing";
import { MILESTONES } from "@/engine/sim";
import { START_YEAR } from "@/engine/types";
import { openResearchOn } from "@/ui/panels/shared";
import { usd } from "@/ui/format";

/**
 * THE YEAR, TOLD BACK — once a December closes. A year used to pass with a
 * toast; everything a player works for (the net worth, the place on the
 * street, the milestones) was on pages they had to go and open. This is the
 * one moment the game stops and says how it went: the verdict first, the
 * numbers behind it, and the next thing worth chasing. Dismiss it anywhere.
 */
export default function YearReview() {
  const y = useStore((s) => s.yearReviewY);
  const game = useStore((s) => s.game);
  const popupsOff = useStore((s) => s.popupsOff);
  const dismiss = useStore((s) => s.dismissYearReview);
  const career = useStore((s) => s.careerCardI);
  if (y === null || !game || popupsOff || game.gameOver || career !== null) return null;
  const r = yearReview(game, y, MILESTONES, START_YEAR);
  if (!r) return null;
  const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}%`;
  const moved = r.rank0 - r.rank1;
  const parcels = useStore.getState().parcels;
  const addr = (bbl: string) => parcels?.[bbl]?.address ?? bbl;
  const go = (page: "research" | "books") => {
    if (page === "research") openResearchOn("street");
    useStore.getState().setPage(page);
    dismiss();
  };
  return (
    <div className="delivery-ceremony year-review" role="dialog" aria-modal="true" aria-labelledby="yr-title" onClick={dismiss}>
      <div className="delivery-stamp year-review-card" onClick={(e) => e.stopPropagation()}>
        <div className="delivery-kicker">The year · {r.year}</div>
        <div className="delivery-title year-review-verdict" id="yr-title">{r.verdict}</div>
        <div className="year-review-grid mono">
          <span>Net worth</span>
          <span className={r.nwPct < 0 ? "neg" : ""}>{usd(r.nw0)} → {usd(r.nw1)} · {pct(r.nwPct)}</span>
          <span>The street's median firm</span>
          <span>{pct(r.streetPct)}</span>
          <span>Your place</span>
          <span>
            {ordinal(r.rank0)} → <strong>{ordinal(r.rank1)}</strong> of {r.of}
            {moved !== 0 && <span className={moved > 0 ? "pos" : "neg"}> {moved > 0 ? "▲" : "▼"}{Math.abs(moved)}</span>}
          </span>
          {r.tier1 && (<><span>Standing</span><span>{r.tier0 && r.tier0 !== r.tier1 ? <>{r.tier0} → <strong>{r.tier1}</strong></> : r.tier1}</span></>)}
          <span>Buildings, after debt</span>
          <span className={r.cashFromBuildings < 0 ? "neg" : ""}>{usd(r.cashFromBuildings)}</span>
          <span>Office and staff</span>
          <span>−{usd(r.overhead)}</span>
          {r.taxes > 0 && (<><span>Tax</span><span>−{usd(r.taxes)}</span></>)}
          <span>Deals</span>
          <span>
            {r.deedsIn} bought · {r.deedsOut} sold · {r.leases} lease{r.leases === 1 ? "" : "s"} signed
          </span>
        </div>
        {(r.star || r.worry) && (
          <div className="year-review-next">
            {r.star && <div>★ <a className="lnk" onClick={() => { useStore.getState().openProperty(r.star!.bbl, "summary"); dismiss(); }}>{addr(r.star.bbl)}</a> — income {usd(r.star.noi0)} → {usd(r.star.noi1)} a year.</div>}
            {r.worry && <div>⚠ <a className="lnk" onClick={() => { useStore.getState().openProperty(r.worry!.bbl, "leasing"); dismiss(); }}>{addr(r.worry.bbl)}</a> — {Math.round(r.worry.occ0 * 100)}% → {Math.round(r.worry.occ1 * 100)}% let. Worth a look.</div>}
          </div>
        )}
        {(r.passed || r.passedBy) && (
          <div className="year-review-next">
            {r.passed ? <>You went past <strong>{r.passed}</strong> this year.</> : <><strong>{r.passedBy}</strong> went past you this year.</>}
          </div>
        )}
        {r.milestones.length > 0 && (
          <div className="year-review-miles">
            {r.milestones.map((m) => <div key={m}>◆ {m}</div>)}
          </div>
        )}
        {r.next && <div className="year-review-next">Next on the ladder: <strong>{r.next.label}</strong></div>}
        <div className="btn-row" style={{ marginTop: 14, justifyContent: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" onClick={dismiss}>On to {r.year + 1}</button>
          <button type="button" className="btn" onClick={() => go("research")}>The street</button>
          <button type="button" className="btn" onClick={() => go("books")}>The books</button>
        </div>
      </div>
    </div>
  );
}

/**
 * A CAREER, CLOSED. The principal's death used to be one line on the tape and
 * the run went on as the heir — decades of work, and nothing said about them.
 * This is the obituary the trade press would write: where they started on the
 * street, where they finished, the best year, the book they handed on.
 */
export function CareerCard() {
  const i = useStore((s) => s.careerCardI);
  const game = useStore((s) => s.game);
  const dismiss = useStore((s) => s.dismissCareerCard);
  if (i === null || !game || game.gameOver) return null;
  const c = careerCard(game, i, MILESTONES, START_YEAR);
  if (!c) return null;
  return (
    <div className="delivery-ceremony year-review" role="dialog" aria-modal="true" aria-labelledby="career-title" onClick={dismiss}>
      <div className="delivery-stamp year-review-card" onClick={(e) => e.stopPropagation()}>
        <div className="delivery-kicker">{c.name} · {c.fromYear}–{c.toYear} · died at {c.age}</div>
        <div className="delivery-title year-review-verdict" id="career-title">{c.verdict}</div>
        <div className="year-review-grid mono">
          <span>The book</span>
          <span>{usd(c.nw0)} handed over → {usd(c.nw1)} at the end</span>
          {c.rank0 !== null && c.rank1 !== null && (<><span>On the street</span><span>{ordinal(c.rank0)} → <strong>{ordinal(c.rank1)}</strong> of {c.of}</span></>)}
          {c.best && (<><span>Best year</span><span>{ordinal(c.best.rank)} of {c.best.of} · {c.best.year}</span></>)}
          <span>Deeds</span><span>{c.bought} bought · {c.sold} sold · {c.years} years</span>
          <span>Estate tax</span><span>{c.tax > 0 ? usd(c.tax) : "under the exclusion"}</span>
        </div>
        {c.milestones.length > 0 && (
          <div className="year-review-miles">{c.milestones.map((m) => <div key={m}>◆ {m}</div>)}</div>
        )}
        <div className="year-review-next">You continue as <strong>{c.heir}</strong>. The buildings stay. The phone book does not.</div>
        <div className="btn-row" style={{ marginTop: 14, justifyContent: "center" }}>
          <button type="button" className="btn btn-primary" onClick={dismiss}>Carry on as {c.heir}</button>
        </div>
      </div>
    </div>
  );
}

/** The milestone banner: gold, four seconds, gone. The ladder is on Books. */
export function MilestoneFlash() {
  const flash = useStore((s) => s.milestoneFlash);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => useStore.setState({ milestoneFlash: null }), 4200);
    return () => clearTimeout(t);
  }, [flash]);
  if (!flash) return null;
  return (
    <div className="milestone-flash" role="status" onClick={() => useStore.setState({ milestoneFlash: null })}>
      <div className="delivery-kicker">Milestone</div>
      {flash.map((m) => <div key={m} className="milestone-flash-line">◆ {m}</div>)}
    </div>
  );
}
