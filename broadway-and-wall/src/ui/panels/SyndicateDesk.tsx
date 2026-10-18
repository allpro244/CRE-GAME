import { useStore } from "@/state/store";
import { monthLabel } from "@/engine/types";
import { ffAvailable, syndicateView } from "@/engine/syndicate";
import { reputationNow, rankStreet, playerTerms, termsLine, bandIdx, BANDS, nextBandNeeds, scaleMult } from "@/engine/reputation";
import { INVESTOR_TYPES, cityAttractiveness, EQUITY_PER_HEAD, committedTotal } from "@/engine/investors";
import { resolveRec } from "@/engine/value";
import { usd } from "@/ui/format";

/** A fraction as a whole percent. */
const pc = (x: number) => `${Math.round(x * 100)}%`;

import { Row } from "@/ui/panels/shared";

/**
 * OUTSIDE EQUITY, DEAL BY DEAL (syndicate.ts). The friends-and-family network:
 * how much it holds, what is in your live deals, and what every deal it was in
 * paid it back — the record anyone you ask for money next will read.
 */
export function SyndicateDesk() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const cap = game.ffNetwork?.cap ?? Math.max(0, Math.round(game.nwHistory?.[0] ?? 0));
  const avail = ffAvailable(game);
  const live = Object.keys(game.syndications ?? {});
  const closed = [...(game.synClosed ?? [])].reverse();
  const rep = reputationNow(game);
  const terms = playerTerms(game);
  const street = rankStreet(game).slice(0, 5);
  const pending = game.reputation?.pending;
  return (
    <>
    <div className="page-section">
      <div className="page-section-head">Your standing with investors</div>
      <div className="hint">
        Investors read every deal you raised against what you pitched them, and rank you against every firm on the street.
        The band they act on is the lower of your rank's and your score's. A promise kept builds the record slowly; a promise
        broken counts in full, however small the deal, the day it is realised. Deals with your own money promised nobody
        anything: they are judged on the multiple, a loss by its size. Buildings you have held two years or more count too, at the appraisal and at 60% of the weight a sale would earn — you do not have to sell to build a record. Your band reads the better of your record rank and your size rank, and size alone never lifts you past what your record allows.
      </div>
      <div className="grid">
        <Row k="Band" v={`${terms.band}${pending ? ` · ${pending} next quarter if it holds` : ""}`} strong />
        <Row k="Investor rank" v={`#${rep.rank} of ${rep.of}${rep.rank === 1 ? " · the top of the street" : rep.rank === rep.of ? " · the bottom of the street" : ` · ahead of ${rep.percentile}% of the street`}`} />
        <Row k="Track-record score" v={`${rep.score.toFixed(1)} · experience ${rep.n.toFixed(1)} from ${rep.deals} good deal${rep.deals === 1 ? "" : "s"}`} bad={rep.score < 0} />
        <Row k="Their terms today" v={termsLine(terms)} />
        <Row k="Outside equity per $1 of yours" v={terms.perOwn > 0 ? `up to $${terms.perOwn}` : "none — nobody will invest"} bad={!(terms.perOwn > 0)} />
        {(() => {
          const me = street.length ? rankStreet(game).find((f) => f.id === "you") : undefined;
          const m = scaleMult(game);
          return me ? <Row k="Size on the street" v={`#${me.sizeRank} of ${rep.of} by equity${m > 1.01 ? ` · scale opens doors: ${m.toFixed(2)}× the outside money, the pace and the reach` : " · the biggest firms raise more, faster, from further afield"}`} /> : null;
        })()}
      </div>
      {bandIdx(terms.band) < BANDS.length - 1 && (() => {
        const nb = nextBandNeeds(game);
        if (!nb) return null;
        return (
          <table className="tbl" style={{ marginTop: 8 }}>
            <thead><tr><th>To reach {nb.next}</th><th>You</th><th>Needed</th></tr></thead>
            <tbody>
              {nb.rows.map((r) => (
                <tr key={r.label}>
                  <td>{r.ok ? "✓ " : "· "}{r.label}</td><td>{r.have}</td>
                  <td style={{ color: r.ok ? undefined : "var(--neg, #a33)" }}>{r.need}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      })()}
      {rep.evidence.length > 0 && (
        <table className="tbl" style={{ marginTop: 8 }}>
          <thead><tr><th>The record</th><th>When</th><th>What it was</th><th>Evidence</th></tr></thead>
          <tbody>
            {[...rep.evidence].reverse().slice(0, 10).map((e, i) => (
              <tr key={i}>
                <td>{e.label}</td>
                <td>{monthLabel(e.m)}</td>
                <td>{e.kind === "investor" ? "with investors" : e.kind === "own" ? "your own money" : "credit event"}</td>
                <td style={{ color: e.ev < 0 ? "var(--neg, #a33)" : undefined }}>{e.ev > 0 ? "+" : ""}{e.ev.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <table className="tbl" style={{ marginTop: 8 }}>
        <thead><tr><th>Top of the street</th><th>Score</th><th>Band</th></tr></thead>
        <tbody>
          {street.map((f) => (
            <tr key={f.id} style={{ fontWeight: f.id === "you" ? 600 : undefined }}>
              <td>#{f.rank} {f.name}</td><td>{f.score.toFixed(1)}</td><td>{f.band}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <div className="page-section">
      <div className="page-section-head">This city's investor money, {monthLabel(game.month)}</div>
      <div className="hint">
        Each year the city draws private real-estate equity in proportion to its people — about ${EQUITY_PER_HEAD} a head at today's
        prices — and how it compares as a place to put money ({Math.round(cityAttractiveness(game.econ) * 100)}% of an ordinary market now).
        Rivals raising in the city draw it down; you raise from what they leave, from the types your band opens.
      </div>
      {(() => {
        const p = game.investorPool;
        const yr = Math.floor(game.month / 12);
        const live = p && p.yr === yr ? p : null;
        const scale = Math.max(0, (game.econ.population ?? 0) * EQUITY_PER_HEAD * (game.econ.priceLevel ?? 1) * (game.econ.cpi ?? 1) * cityAttractiveness(game.econ));
        return (
          <table className="tbl" style={{ marginTop: 8 }}>
            <thead><tr><th>Investors</th><th>This year</th><th>Raised already</th><th>Open to you</th></tr></thead>
            <tbody>
              {INVESTOR_TYPES.map((t) => {
                const cap = live ? live.cap[t.id] ?? 0 : Math.round(scale * t.share);
                const used = live ? live.used[t.id] ?? 0 : 0;
                const open = bandIdx(terms.band) >= bandIdx(t.band);
                return (
                  <tr key={t.id}>
                    <td>{t.label}</td><td>{usd(cap)}</td><td>{usd(used)}</td>
                    <td style={{ color: open ? undefined : "var(--muted, #888)" }}>{open ? usd(Math.max(0, cap - used)) : `from ${t.band}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        );
      })()}
      {Object.values(game.raises ?? {}).map((r) => (
        <div key={r.bbl} className="hint" style={{ marginTop: 6 }}>
          Raising for {resolveRec(parcels, game, r.bbl)?.address ?? r.bbl}: {usd(committedTotal(r))} of {usd(r.target)} circled, closes in {Math.max(0, r.deadlineM - game.month)} month{r.deadlineM - game.month === 1 ? "" : "s"}.
        </div>
      ))}
    </div>
    <div className="page-section">
      <div className="page-section-head">Outside equity · deal by deal</div>
      <div className="hint">
        Raised one job at a time on the Build desk, on your band's terms ({termsLine(terms)}).
        You guarantee completion. Pay them back with a profit and they bring it back to you; lose their money and most of them are gone.
      </div>
      <div className="grid">
        <Row k="Your network" v={usd(cap)} />
        <Row k="In your live deals" v={usd(Math.max(0, cap - avail))} />
        <Row k="Free to raise" v={usd(avail)} bad={avail <= 0} />
      </div>
      {live.length > 0 && (
        <table className="tbl" style={{ marginTop: 8 }}>
          <thead><tr><th>Live</th><th>Committed</th><th>Called</th><th>Paid back</th><th>Yours · theirs</th></tr></thead>
          <tbody>
            {live.map((b) => {
              const v = syndicateView(game, parcels, b);
              if (!v) return null;
              return (
                <tr key={b}>
                  <td>{resolveRec(parcels, game, b)?.address ?? b}</td>
                  <td>{usd(v.lpCommit)}</td>
                  <td>{usd(v.lpCalled)}</td>
                  <td>{usd(v.lpDist)}</td>
                  <td>{usd(v.yours)} · {usd(v.theirs)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {closed.length > 0 && (
        <table className="tbl" style={{ marginTop: 8 }}>
          <thead><tr><th>Wound up</th><th>When</th><th>They put in</th><th>They took back</th><th>Their IRR</th></tr></thead>
          <tbody>
            {closed.slice(0, 12).map((r) => (
              <tr key={`${r.bbl}-${r.closedM}`}>
                <td>{r.address}</td>
                <td>{monthLabel(r.formedM)} – {monthLabel(r.closedM)}</td>
                <td>{usd(r.lpIn)}</td>
                <td style={{ color: r.lpOut < r.lpIn ? "var(--neg, #a33)" : undefined }}>{usd(r.lpOut)} · {(r.lpIn > 0 ? r.lpOut / r.lpIn : 0).toFixed(2)}x</td>
                <td>{r.lpIrr === null ? "—" : pc(r.lpIrr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
    </>
  );
}
