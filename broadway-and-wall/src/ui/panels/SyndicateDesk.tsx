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
      <div className="page-section-head">Investor reputation</div>
      <div className="hint">
        Score: syndicated deals vs pitch (misses count in full) · own-money deals on multiple · holds 2+ yrs at appraisal, 60% weight · band = better of record and size rank, capped by record
      </div>
      <div className="grid">
        <Row k="Band" v={`${terms.band}${pending ? ` · ${pending} next quarter if it holds` : ""}`} strong />
        <Row k="Investor rank" v={`#${rep.rank} of ${rep.of}${rep.rank === 1 || rep.rank === rep.of ? "" : ` · ${rep.percentile}th percentile`}`} />
        <Row k="Track-record score" v={`${rep.score.toFixed(1)} · experience ${rep.n.toFixed(1)} · ${rep.deals} good deal${rep.deals === 1 ? "" : "s"}`} bad={rep.score < 0} />
        <Row k="LP terms" v={termsLine(terms)} />
        <Row k="LP equity per $1 GP" v={terms.perOwn > 0 ? `up to $${terms.perOwn}` : "none"} bad={!(terms.perOwn > 0)} />
        {(() => {
          const me = street.length ? rankStreet(game).find((f) => f.id === "you") : undefined;
          const m = scaleMult(game);
          return me ? <Row k="Size rank" v={`#${me.sizeRank} of ${rep.of} by equity${m > 1.01 ? ` · scale ${m.toFixed(2)}× on LP capital, pace, reach` : ""}`} /> : null;
        })()}
      </div>
      {bandIdx(terms.band) < BANDS.length - 1 && (() => {
        const nb = nextBandNeeds(game);
        if (!nb) return null;
        return (
          <table className="tbl" style={{ marginTop: 8 }}>
            <thead><tr><th>Next: {nb.next}</th><th>Current</th><th>Needed</th></tr></thead>
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
          <thead><tr><th>Deal</th><th>Date</th><th>Type</th><th>Score</th></tr></thead>
          <tbody>
            {[...rep.evidence].reverse().slice(0, 10).map((e, i) => (
              <tr key={i}>
                <td>{e.label}</td>
                <td>{monthLabel(e.m)}</td>
                <td>{e.kind === "investor" ? "syndicated" : e.kind === "own" ? "own capital" : "credit event"}</td>
                <td style={{ color: e.ev < 0 ? "var(--neg, #a33)" : undefined }}>{e.ev > 0 ? "+" : ""}{e.ev.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <table className="tbl" style={{ marginTop: 8 }}>
        <thead><tr><th>Top firms</th><th>Score</th><th>Band</th></tr></thead>
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
      <div className="page-section-head">Local LP capital · {monthLabel(game.month)}</div>
      <div className="hint">
        ~${EQUITY_PER_HEAD}/resident/yr × attractiveness {Math.round(cityAttractiveness(game.econ) * 100)}% · shared with rivals · access by band
      </div>
      {(() => {
        const p = game.investorPool;
        const yr = Math.floor(game.month / 12);
        const live = p && p.yr === yr ? p : null;
        const scale = Math.max(0, (game.econ.population ?? 0) * EQUITY_PER_HEAD * (game.econ.priceLevel ?? 1) * (game.econ.cpi ?? 1) * cityAttractiveness(game.econ));
        return (
          <table className="tbl" style={{ marginTop: 8 }}>
            <thead><tr><th>Investor type</th><th>This year</th><th>Raised</th><th>Available</th></tr></thead>
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
          Raising · {resolveRec(parcels, game, r.bbl)?.address ?? r.bbl} · {usd(committedTotal(r))} of {usd(r.target)} committed · closes in {Math.max(0, r.deadlineM - game.month)} month{r.deadlineM - game.month === 1 ? "" : "s"}
        </div>
      ))}
    </div>
    <div className="page-section">
      <div className="page-section-head">Syndications</div>
      <div className="hint">
        Raised per project on the Build desk · {termsLine(terms)} · completion guaranteed by you · losses shrink the network
      </div>
      <div className="grid">
        <Row k="Network capacity" v={usd(cap)} />
        <Row k="Committed" v={usd(Math.max(0, cap - avail))} />
        <Row k="Available" v={usd(avail)} bad={avail <= 0} />
      </div>
      {live.length > 0 && (
        <table className="tbl" style={{ marginTop: 8 }}>
          <thead><tr><th>Live</th><th>Committed</th><th>Called</th><th>Distributed</th><th>GP · LP</th></tr></thead>
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
          <thead><tr><th>Closed</th><th>Period</th><th>LP in</th><th>LP out</th><th>LP IRR</th></tr></thead>
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
