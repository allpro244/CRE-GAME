import { useState, Fragment } from "react";
import { useStore } from "@/state/store";
import { monthLabel } from "@/engine/types";
import { resolveRec, netWorth } from "@/engine/value";
import { marketAppetite, markRival, rivalCondition, rivalTemperamentWeight, firmEntryPitch } from "@/engine/rivals";
import { rivalPrincipalOf } from "@/engine/people";
import { ownerById } from "@/engine/ownership";
import { OwnerStatement } from "@/ui/panels/OwnersDesk";
import { PersonCard, personAgeLine } from "@/ui/PersonCard";
import { firmName } from "@/engine/firm";
import { usd, sf } from "@/ui/format";
import { Row, STYLE_MAX, CONDITION_WORD, STYLE_WORD } from "@/ui/panels/shared";

// THE STREET. Who else is buying, what they own, and how much rope they have
// left. This is not decoration: the appetite number at the top is the same one
// that decides whether your lowball gets refused, and a firm sliding toward
// its covenants is a firm whose buildings are about to be cheap.
/**
 * WHAT A RIVAL IS WORTH, once — gross assets marked the way `markRival` marks
 * them, less the debt against them, plus what is in the bank. It is the same
 * arithmetic the player's own Books page calls net worth, which is the point:
 * a league table is only a league table if both sides are measured the same
 * way. Written down here because three places on this page print it and one
 * quantity does not get three expressions.
 */
export const rivalEquity = (m: { aum: number }, r: { debt: number; cash: number }) => m.aum - r.debt + r.cash;

export function TheStreet() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const focus = useStore((s) => s.focus);
  const [open, setOpen] = useState<string | null>(null);
  const rivals = game.rivals ?? [];
  if (!rivals.length) return null;
  const appetite = marketAppetite(game);
  // Same number as TopBar / Books — a street rank that re-derives equity is
  // one quantity with two answers (facility, loc, deposits, CIP, notes).
  const playerEquity = netWorth(game, parcels);
  const marked = rivals.map((r) => ({ r, m: markRival(game, parcels, r) }))
    .sort((a, b) => (a.r.failedM !== undefined ? 1 : 0) - (b.r.failedM !== undefined ? 1 : 0) || b.m.aum - a.m.aum);
  return (
    <>
      <div className="page-section">
        The street · competing money {appetite < 0.6 ? "has left the room" : appetite < 0.9 ? "is thin" : appetite > 1.15 ? "is everywhere" : "is normal"}
      </div>
      <div className="hint">
        These firms bid on the same tape you do, with their own money — a firm without the equity does not
        close, and one already at its covenant cannot borrow to. When their dry powder is high your lowballs
        get refused; when their leverage runs past their covenants they sell into whatever bid exists, and
        that bid is you. The principal column is who runs the shop and how old they are — equity alone cannot
        tell you the next thirty years. Click any firm for its balance sheet and what it owns.
      </div>
      {/* THE DOOR TO THE STREET. How many firms this town carries is an output
          of two terms — whether buildings yield over the debt against them,
          and whether there are trades to go round the firms already here —
          and both were invisible, so a new name on the tape read as spawned
          rather than raised. firmEntryPitch is the engine's own raise gate,
          pure, the same call `pnpm firms` audits. */}
      {(() => {
        const ep = firmEntryPitch(game);
        const streetOpen = ep.leverage > 0 && ep.product > 0 && ep.pitch > 0;
        const line = !streetOpen
          ? ep.leverage <= 0
            ? "Nobody is raising a new fund into this street today: buildings yield less than the debt against them, and no allocator pays fees for negative leverage."
            : "Nobody is raising a new fund into this street today: nothing has traded in a year, so there is no product to pitch a first close on."
          : `The street is open to a new raise — cap rates clear the cost of debt, and ${ep.traded} trade${ep.traded === 1 ? "" : "s"} went round ${ep.firms} firm${ep.firms === 1 ? "" : "s"} this past year`
            + `${ep.thin > 1.15 ? ", with few bidders contesting them" : ""}. On these terms somebody will eventually clear a first close.`;
        const bids = game.founderBids ?? [];
        return (
          <>
            <div className="hint">{line}</div>
            {bids.length > 0 && (
              <div className="grid" style={{ marginBottom: 10 }}>
                {bids.map((b) => (
                  <Row
                    key={`${b.name}:${b.readyM}`}
                    k="Raising now"
                    v={`${b.name}, raising out of ${b.fromFirmName}`
                      + (b.readyM > game.month
                        ? ` · on the street from ${monthLabel(b.readyM)}`
                        : ` · ${Math.max(0, FOUNDER_WINDOW_M - (b.openMs ?? 0))} open month${FOUNDER_WINDOW_M - (b.openMs ?? 0) === 1 ? "" : "s"} left to clear a first close`)}
                  />
                ))}
              </div>
            )}
          </>
        );
      })()}
      {/* THE LEAGUE TABLE. They started where you started — five to eighteen
          million and a hundred years — so the only honest way to read your own
          number is against theirs. */}
      <div className="grid" style={{ marginBottom: 10 }}>
        {(() => {
          const board = [
            { name: firmName(game), eq: playerEquity, me: true },
            ...marked.filter((x) => x.r.failedM === undefined)
              .map((x) => ({ name: x.r.name, eq: rivalEquity(x.m, x.r), me: false })),
          ].sort((a, b) => b.eq - a.eq);
          const rank = board.findIndex((b) => b.me) + 1;
          return (
            <>
              <Row k="Your place on the street" v={`${rank} of ${board.length} by equity`} strong bad={rank > board.length / 2} />
              <Row k="The biggest book in town" v={`${board[0].name} · ${usd(board[0].eq)}`} />
            </>
          );
        })()}
      </div>
      <table className="tbl">
        <thead>
          <tr>
            {/* NET EQUITY, ON THE TABLE. It was computed twice already — once
                inside the league-table grid above, which ranks you against it,
                and once inside each firm's drawer as "Net worth" — and the
                column list did not carry it, so the one number that says who
                is actually winning was two clicks deep. Gross assets less debt
                plus cash, exactly as the drawer and the ranking compute it;
                three expressions for one quantity is how a table comes to
                disagree with the row it expands into, so all three now read
                the same `eq` off `markRival` and the firm's own balance. */}
            <th>Firm</th><th>Principal</th><th>Style</th><th className="num">Buildings</th><th className="num">Gross assets</th>
            <th className="num">Debt</th><th className="num">Net equity</th>
            <th className="num">Leverage</th><th className="num">Dry powder</th><th>Read</th>
          </tr>
        </thead>
        <tbody>
          {marked.map(({ r, m }) => {
            const dead = r.failedM !== undefined;
            const stress = (r.stressMs ?? 0) > 0;
            const isOpen = open === r.id;
            const principal = rivalPrincipalOf(game, r.id);
            return (
              <Fragment key={r.id}>
              <tr className={dead ? "dim" : ""} style={{ cursor: "pointer" }}
                onClick={() => setOpen(isOpen ? null : r.id)}>
                <td title={r.spawnedFrom ? `Raised out of ${r.spawnedFrom.firmName} · ${r.spawnedFrom.personName}` : undefined}>
                  {isOpen ? "▾ " : "▸ "}{r.name}
                  {r.spawnedFrom ? <span className="dim"> · from {r.spawnedFrom.firmName}</span> : null}
                </td>
                <td className="dim">{dead ? "—" : personAgeLine(principal, game.month)}</td>
                <td className="dim">{STYLE_WORD[r.style]}</td>
                <td className="num">{dead ? (r.bbls.length ? `${r.bbls.length} in workout` : "—") : r.bbls.length}</td>
                <td className="num">{dead ? "—" : usd(m.aum)}</td>
                <td className={"num" + (!dead && r.debt > 0 ? " dim" : "")}>{dead ? "—" : usd(r.debt)}</td>
                {/* THE NUMBER THE OWNER ASKED FOR. A firm running a billion of
                    gross assets at 85% leverage has less of its own money in
                    the game than a family trust with two hundred million
                    unencumbered, and the first four columns could not tell you
                    that. Negative is not a rounding artefact — it is a firm
                    whose buildings no longer cover its paper, which is the
                    condition that turns them into your seller. */}
                <td className={"num" + (!dead && rivalEquity(m, r) < 0 ? " neg" : "")}>
                  {dead ? "—" : usd(rivalEquity(m, r))}
                </td>
                {/* debt against no assets is not a ratio, it is a hole */}
                <td className={"num" + (!dead && m.ltv > 0.8 ? " neg" : "")}>
                  {dead ? "—" : m.aum <= 0 ? (r.debt > 0 ? "no assets" : "—") : `${(m.ltv * 100).toFixed(0)}%`}
                </td>
                <td className="num">{dead ? "—" : usd(Math.max(0, r.cash))}</td>
                <td className="dim">
                  {dead ? (r.bbls.length
                    ? `Failed ${monthLabel(r.failedM!)} — the receiver is still selling`
                    : `Gone, ${monthLabel(r.failedM!)}`)
                    : m.aum <= 0 && r.debt > 0 ? "Sold everything and still owes money — they are finished"
                    : stress ? "Selling under pressure — their tape is your opportunity"
                    : m.ltv > 0.75 ? "Levered up. One bad cycle from being a seller"
                    : r.cash > m.aum * 0.06 ? "Sitting on cash. They will outbid you"
                    : "Fully invested"}
                </td>
              </tr>
              {isOpen && (() => {
                // ONE DRAWER FOR EVERY OWNER IN TOWN. This used to be a
                // hand-built balance sheet that only firms had, and it is the
                // reason the register beside it could not show one: the
                // arithmetic lived in a panel rather than in the engine, so a
                // private holder had nowhere to get it from. It is
                // `OwnerStatement` now, shared with the Owners page, fed by
                // engine/ownership.ts — which means the number the street
                // table prints and the number the register prints cannot come
                // apart, and a family office is read exactly the way a fund is.
                const view = ownerById(game, parcels, r.id);
                if (!view) return null;
                return (
                <tr>
                  <td colSpan={10} style={{ background: "rgba(43,37,26,0.035)" }}>
                    <OwnerStatement
                      o={view}
                      onFocus={(b) => focus(b, true)}
                      extra={
                        <>
                          {principal && !dead && (
                            <PersonCard person={principal} game={game} showAttrs={false} title="Operating principal" />
                          )}
                          {principal && !dead && (() => {
                            const tw = rivalTemperamentWeight(game, r);
                            const pace = tw > 1.12 ? "Contests the tape hard"
                              : tw < 0.88 ? "Patient bidder — slower on contested asks"
                                : "Ordinary pace on the tape";
                            return (
                              <div className="hint" style={{ marginBottom: 6 }} title="Bandwidth × Access — temperament, not their balance sheet">
                                {pace}
                              </div>
                            );
                          })()}
                        </>
                      }
                      extraLate={
                        <>
                          {/* WHAT A FIRM HAS THAT A HOLDER DOES NOT: a covenant
                              it is running against, a book that fills and
                              empties, a capital plan it can be short of the
                              cash for, and partners it has already paid. */}
                          <div className="grid" style={{ margin: "6px 0" }}>
                            <Row k="They stop borrowing at" v={`${(STYLE_MAX[r.style] * 100).toFixed(0)}% LTV`} bad={m.ltv > STYLE_MAX[r.style]} />
                            {r.occ !== undefined && (
                              <Row k="Portfolio occupancy" v={`${(r.occ * 100).toFixed(0)}%`} bad={r.occ < 0.8} />
                            )}
                            {/* The run-rate above says what a capital plan
                                COSTS; this says what they actually spent. A
                                firm far under its own plan is a firm whose
                                buildings are sliding, and the gap is the tell. */}
                            <Row k="Condition of the book"
                              v={`${CONDITION_WORD[rivalCondition(r)]} · ${usd(r.capexYr ?? 0)} actually spent this year`}
                              bad={(r.condIdx ?? 1) < 0.55} />
                            <Row k="Taken out to date" v={usd(r.distributed ?? 0)}
                              title="Realised and no longer on this balance sheet — modest equity is not the same as a bad century." />
                            <Row k="Founded" v={r.bornM > 0 ? monthLabel(r.bornM) : "before you arrived"} />
                            {r.spawnedFrom && (
                              <Row k="Raised out of" v={`${r.spawnedFrom.firmName} · ${r.spawnedFrom.personName}`} />
                            )}
                          </div>
                          {/* WHAT THEY HAVE IN THE GROUND. A firm's live jobs are
                              the part of its balance sheet that is pure risk:
                              money spent, debt drawn, nothing earning. It is also
                              the space that is coming for your tenants in two
                              years. */}
                          {(() => {
                            const jobs = (game.cityJobs ?? []).filter((j) => j.firmId === r.id);
                            if (!jobs.length) return null;
                            return (
                              <>
                                <div className="page-section" style={{ marginTop: 4 }}>
                                  Under construction · {jobs.length}
                                </div>
                                <div className="mini-list">
                                  {jobs.map((j) => {
                                    const rec = resolveRec(parcels, game, j.bbl);
                                    const pct = Math.min(100, Math.max(0, ((game.month - j.startM) / Math.max(1, j.deliverM - j.startM)) * 100));
                                    return (
                                      <button key={j.bbl} className="neighbor"
                                        onClick={(ev) => { ev.stopPropagation(); focus(j.bbl, true); }}>
                                        <span className="neighbor-addr">{rec?.address ?? j.bbl}</span>
                                        <span className="neighbor-meta">
                                          {sf(j.sf)} {j.use} · {j.floors} fl · {pct.toFixed(0)}% ·{" "}
                                          {j.orphaned ? "stalled — the sponsor is gone" : `due ${monthLabel(j.deliverM)}`}
                                          {j.debt ? ` · ${usd(j.debt)} drawn` : ""}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </>
                            );
                          })()}
                        </>
                      }
                    />
                  </td>
                </tr>
                );
              })()}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

// Open-market months a ready founder keeps pitching before the street closes
// on them — mirrored from FOUNDER_WINDOW_M inside maybeNewFirm in
// engine/rivals.ts, which is not exported. The window counts months the
// street would actually take a raise, not calendar months queued through a
// credit crunch; if the engine's window moves, this must move with it.
const FOUNDER_WINDOW_M = 18;

// The three label tables that used to live here moved to shared.tsx when the
// register and the street table started rendering the same drawer: StreetDesk
// imports OwnerStatement from OwnersDesk, so OwnersDesk cannot import labels
// back from here without a cycle. Re-exported because DebtPage re-exports them
// from this file and half a dozen call sites read them through that door.
export { STYLE_MAX, CONDITION_WORD, STYLE_WORD } from "@/ui/panels/shared";
