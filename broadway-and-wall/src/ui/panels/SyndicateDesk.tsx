import { useStore } from "@/state/store";
import { monthLabel } from "@/engine/types";
import { FF_TERMS, ffAvailable, syndicateView } from "@/engine/syndicate";
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
  return (
    <div className="page-section">
      <div className="page-section-head">Outside equity · friends and family</div>
      <div className="hint">
        Raised one job at a time on the Build desk, from people who know you: at most a dollar of theirs for each of yours,
        a {pc(FF_TERMS.hurdles[0])} pref, and {pc(FF_TERMS.promotes[1])} of what is above a {pc(FF_TERMS.hurdles[1])} IRR to you.
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
  );
}
