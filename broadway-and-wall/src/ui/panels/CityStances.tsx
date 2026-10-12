import { useStore } from "@/state/store";
import { districtLabelOf } from "@/engine/mix";
import { portfolioIndustries } from "@/engine/comps";
import { INDUSTRY_LABEL, SECTORS } from "@/engine/market";
import { resolveRec } from "@/engine/value";
import { monthLabel } from "@/engine/types";
import type { GameState } from "@/engine/types";
import { Row } from "@/ui/panels/shared";

/**
 * TWO STANCES OF CITY → MARKETS that used to be Research tabs.
 *
 * Employers (the old Trades) is a demand driver — the industries that fill the
 * space markets — and Districts (rezoning) is the geography of the envelope.
 * Both are read against the rent and vacancy on the Markets page, so they are
 * stances beside the four classes, land and the banks rather than a separate
 * room.
 */

/** The board's own odds, in the words a lawyer would use. The filed
 *  percentage sits in the tooltip — the band is the honest read of a one-shot
 *  hearing, not a number with a decimal on it. */
export const oddsWord = (o: number) => o >= 0.7 ? "they usually say yes to this"
  : o >= 0.55 ? "better than even"
  : o >= 0.45 ? "a coin toss"
  : o >= 0.25 ? "an uphill hearing"
  : "a long shot";

/** Every variance application the firm has in front of the board. */
export function pendingHearings(game: GameState) {
  const apps = Object.values(game.varianceApps ?? {});
  // The legacy singular field survives on a save loaded mid-session; the
  // migration folds it in on the next tick, so read both here.
  if (game.varianceApp && !apps.some((a) => a.bbl === game.varianceApp!.bbl)) apps.push(game.varianceApp);
  return apps.sort((a, b) => a.decideM - b.decideM);
}

/** WHICH WAY THE BOARD IS LEANING. The walk is scarcity-driven — a city short
 *  of room gets its envelopes let out, a glutted one gets them pulled in — and
 *  the recent record is the only forward read a landowner gets. zoneLog keeps
 *  one entry per district (its last move), so this counts districts moved, not
 *  motions heard. */
export function boardClimate(game: GameState) {
  const moved = Object.values(game.zoneLog ?? {}).filter((v) => game.month - v.m <= 60);
  const up = moved.filter((v) => v.dir === 1).length;
  const down = moved.length - up;
  const text = moved.length === 0
    ? "no district has moved inside five years — the map is what it was"
    : `${up} district${up === 1 ? "" : "s"} up, ${down} down inside five years — `
      + (up > down ? "the city is short of room and the board is letting envelopes out"
        : down > up ? "the board is pulling envelopes in"
        : "no direction to speak of");
  return { up, down, text };
}

export function Districts() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const apps = pendingHearings(game);
  const climate = boardClimate(game);
  const dists = [...new Set(Object.values(parcels).map((p) => p.district).filter(Boolean))].sort();
  return (
    <div>
      <div className="page-section">Districts — the zoning board</div>
      <div className="hint">
        A rezoning is the largest single value event that can happen to a piece of dirt, and it lands on a
        whole district at once. This is the record: where each district's envelope sits against what it was
        generated with, and the last time the board moved it. You do not control it — you read it, and you
        own the dirt before it lands or you do not.
      </div>
      {/* YOUR OWN PAPER IN FRONT OF THE BOARD. The parcel card shows one
          application on one lot; a firm with three filings pending had no page
          that listed them, and a hearing date you cannot see is a hearing you
          find out about from the news. */}
      {apps.length > 0 && (
        <>
          <div className="page-section-head" style={{ marginTop: 8 }}>Hearings pending · {apps.length}</div>
          <div className="mini-list" style={{ marginBottom: 10 }}>
            {apps.map((a) => (
              <button
                key={a.bbl}
                className="neighbor"
                title={`Filed ${monthLabel(a.filedM)} at ${Math.round(a.odds * 100)}% odds — put the camera on the site`}
                onClick={() => useStore.getState().focus(a.bbl, true)}
              >
                <span className="neighbor-addr">{resolveRec(parcels, game, a.bbl)?.address ?? a.bbl}</span>
                <span className="neighbor-meta mono">
                  +{a.grant.toFixed(1)} FAR asked · board sits {monthLabel(a.decideM)} · {oddsWord(a.odds)}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="grid" style={{ marginBottom: 8 }}>
        <Row k="The board's climate" v={climate.text} strong={climate.up > climate.down} bad={climate.down > climate.up} />
      </div>
      <table className="tbl">
        <thead>
          <tr><th>District</th><th className="num">Envelope vs start</th><th>Last rezoning</th><th>Direction</th></tr>
        </thead>
        <tbody>
          {dists.map((d) => {
            const adj = game.zoneAdj?.[d] ?? 1;
            const log = game.zoneLog?.[d];
            return (
              <tr key={d}>
                <td>{districtLabelOf(parcels, d)}</td>
                <td className={"num" + (adj < 1 ? " neg" : "")}>{(adj * 100).toFixed(0)}%</td>
                <td className="dim">{log ? monthLabel(log.m) : "never"}</td>
                <td className={log?.dir === -1 ? "neg" : "dim"}>
                  {log ? (log.dir === 1 ? "upzoned" : "downzoned") : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One trade's read, shared by the Markets table and the Pulse summary so the
 *  two cannot word the same cycle differently. */
export function tradeRead(ph: string, mySh: number) {
  return ph === "bust" && mySh > 0.25 ? "You are heavily exposed to a trade that is contracting."
    : ph === "bust" ? "Anyone let to them is about to have a bad two years."
    : ph === "boom" ? "They are expanding and they will pay to stay."
    : "Nothing happening either way.";
}

export function tradeRows(game: GameState) {
  const mine = portfolioIndustries(game);
  const byMe = new Map(mine.rows.map((r) => [r.sector, r.share]));
  return SECTORS.map((k) => ({
    k,
    label: INDUSTRY_LABEL[k],
    mom: game.econ.industryMom?.[k] ?? 0,
    phase: game.econ.industryPhase?.[k] ?? "steady",
    mine: byMe.get(k) ?? 0,
  }));
}

/** THE TRADES. A separate cycle from the four asset classes and the reason two
 *  identical office buildings are different assets: one let to insurers, one
 *  let to startups. */
export function Employers() {
  const game = useStore((s) => s.game)!;
  return (
    <div>
      <div className="page-section">Employers — the trades that fill the space</div>
      <div className="hint">
        Industries run their own cycles, on their own volatility, independent of the property market that houses
        them. Office can be a landlord's market while finance is shedding staff — and the building let to five
        startups empties while the one across the street let to insurers does not.
      </div>
      <table className="tbl">
        <thead>
          <tr><th>Trade</th><th>Cycle</th><th className="num">Momentum</th><th className="num">Your exposure</th><th>Read</th></tr>
        </thead>
        <tbody>
          {tradeRows(game).map((t) => (
            <tr key={t.k}>
              <td>{t.label}</td>
              <td className={t.phase === "bust" ? "neg" : "dim"}>
                {t.phase === "boom" ? "hiring hard" : t.phase === "bust" ? "contracting" : "steady"}
              </td>
              <td className={"num" + (t.mom < -0.004 ? " neg" : "")}>{(t.mom * 100).toFixed(2)}</td>
              <td className={"num" + (t.mine > 0.4 ? " neg" : "")}>{t.mine > 0 ? `${(t.mine * 100).toFixed(0)}%` : "—"}</td>
              <td className="dim">{tradeRead(t.phase, t.mine)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
