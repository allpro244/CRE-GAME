import { useMemo, useState, Fragment } from "react";
import Slider from "@/ui/Slider";
import { useStore } from "@/state/store";
import { CLASS_LABEL } from "@/data/types";
import { monthLabel, OPS_SERVICE, OPS_PLAN, START_YEAR } from "@/engine/types";
import { assetValue, initialCondition, holdingValue, holdingNOIYr, resolveRec, netWorth } from "@/engine/value";
import { isCommercial } from "@/engine/leasing";
import { PRODUCTS, productById } from "@/engine/debt";
import { facilityQuotes, facilityMetrics, facilityStatus, pledgeable, pledged, releaseCost, allocatedAmount, FACILITY_MIN_ASSETS, RELEASE_PREMIUM } from "@/engine/facility";
import { holderOf, relOf, isCold, standingWith } from "@/engine/owners";
import { lenderHealth, capitalRatio, lenderBlurb, targetCapital } from "@/engine/lenders";
import { firmName, firmShort } from "@/engine/firm";
import { locLimit, locRate } from "@/engine/credit";
import { LineChart } from "@/ui/Chart";
import { sponsorStanding } from "@/engine/sponsor";
import { marketAppetite, markRival, rivalCondition, gradeOf } from "@/engine/rivals";
import { compFlows, compStats } from "@/engine/comps";
import { usd, sf, pct } from "@/ui/format";
import { bankStatement, CapSpark } from "@/ui/panels/NotesPage";
import { RefiSection } from "@/ui/panels/ParcelDesk";
import { useLabel, Big, Row } from "@/ui/panels/shared";

export function TheBanks() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const focus = useStore((s) => s.focus);
  const lenders = game.lenders ?? [];
  const [open, setOpen] = useState<string | null>(null);
  if (!lenders.length) return null;
  const yoursTotal = lenders.reduce((a, l) => a + l.yours, 0);
  return (
    <>
      <div className="page-section">The banks</div>
      <div className="hint">
        Every desk on this street has its own balance sheet, and when it goes wrong it goes wrong at a name, not
        at the market. Capital ratio is what they have behind the book; appetite is what is left of their advance
        rate. Below about 0.12 they stop quoting entirely — and unlike the cycle, you can watch this coming.
        {" "}<b>Click a bank to open its statement</b> — every loan on that desk, yours and the street's,
        property by property, with the funding margin and the capital history behind it.
      </div>
      {/* EVERY DESK ON ONE AXIS. The sparkline inside a statement answers
          "how is this desk"; opened one at a time it cannot answer "WHICH
          desk", which is the question refinancing actually asks. Each line is
          capital ratio over the desk's OWN target — the kinds run wildly
          different books (a conduit holds 4%, an insurer 18%), so the raw
          ratios share no scale but the multiples do. 1.0× is managed to plan;
          the examiners' patience runs out around 0.22× of target. */}
      {(() => {
        const withHist = lenders.filter((l) => (l.capHist?.length ?? 0) > 1);
        if (withHist.length < 2) return null;
        const C = ["#3d6f9e", "#a8562e", "#4a7d5a", "#7a6a45", "#8a5620", "#2f6f7a"];
        // capHist is sampled in lockstep, but a desk refounded by a receiver
        // starts its history short — right-align on the shortest so every
        // point in a vertical slice is the same quarter.
        const m = Math.min(...withHist.map((l) => l.capHist!.length));
        return (
          <>
            <LineChart height={140}
              series={withHist.map((l, i) => ({
                label: l.name, color: C[i % C.length],
                pts: l.capHist!.slice(-m).map((v) => v / targetCapital(l.name)),
              }))}
              bands={[{ at: 1, label: "own target", color: "#8b8370" }, { at: 0.22, label: "seized" }]}
              yFmt={(v) => `${v.toFixed(1)}×`}
              xLabels={[`${Math.round(m / 4)} yrs ago`, "now"]}
            />
            <div className="hint">
              {withHist.map((l, i) => (
                <span key={l.id} style={{ marginRight: 14, whiteSpace: "nowrap" }}>
                  <span style={{ display: "inline-block", width: 12, height: 3, background: C[i % C.length], verticalAlign: "middle", marginRight: 5 }} />
                  {l.name}
                </span>
              ))}
              — quarterly, as a multiple of each desk's own capital target. A line walking down toward the
              seizure band is the most readable warning in the game: refinance away from that desk while it
              still quotes.
            </div>
          </>
        );
      })()}
      <table className="tbl">
        <thead>
          <tr>
            <th>Lender</th><th>Funded by</th><th className="num">Book</th><th className="num">Capital</th>
            <th className="num">Cap ratio</th><th className="num">Income / yr</th><th className="num">Delinquent</th>
            <th className="num">Charge-offs yr</th>
            <th className="num">Appetite</th><th className="num">Your debt</th><th>Standing</th>
          </tr>
        </thead>
        <tbody>
          {lenders.map((l) => {
            const h = lenderHealth(l);
            const cr = capitalRatio(l);
            const conc = l.book > 0 ? l.yours / l.book : 0;
            return (
              <Fragment key={l.id}>
                <tr onClick={() => setOpen(open === l.id ? null : l.id)} style={{ cursor: "pointer" }}>
                  <td>{open === l.id ? "▾ " : "▸ "}{l.name}</td>
                  <td className="dim">
                    {l.kind === "bank" ? "deposits" : l.kind === "life" ? "insurance float"
                      : l.kind === "conduit" ? "selling the paper on" : "committed capital"}
                  </td>
                  <td className="num">{usd(l.book)}</td>
                  <td className={"num" + (l.capital <= 0 ? " neg" : "")}>{usd(l.capital)}</td>
                  <td className={"num" + (h.bad ? " neg" : "")}>{(cr * 100).toFixed(1)}%</td>
                  {/* WHAT THE DESK IS ACTUALLY EARNING, which the engine has
                      always computed and only ever showed inside the expanded
                      statement. It is the number that decides everything else
                      in this row: capital is last year's income, appetite is
                      this year's, and a desk earning nothing is a desk about to
                      stop quoting. Interest less funding cost less losses,
                      year to date — so it resets each January and a desk read
                      in February is showing you one month. */}
                  <td className={"num" + (l.netIncomeYr < 0 ? " neg" : "")}
                      title="Interest earned less funding cost less charge-offs, this calendar year to date. Resets each January.">
                    {l.failedM !== undefined ? "—" : usd(l.netIncomeYr)}
                  </td>
                  <td className={"num" + (l.delinquent > 0.045 ? " neg" : "")}>{(l.delinquent * 100).toFixed(2)}%</td>
                  <td className="num">{l.chargeOffsYr > 0 ? usd(l.chargeOffsYr) : "—"}</td>
                  <td className={"num" + (l.appetite < 0.5 ? " neg" : "")}>
                    {l.failedM !== undefined ? "—" : l.appetite.toFixed(2)}
                  </td>
                  <td className="num">{l.yours > 0 ? usd(l.yours) : "—"}</td>
                  <td className={h.bad ? "neg" : "dim"}>{h.word}</td>
                </tr>
                {open === l.id && (
                  <tr>
                    <td colSpan={11} className="dim" style={{ paddingBottom: 12 }}>
                      <div style={{ marginBottom: 6 }}>{lenderBlurb(l.name)}</div>
                      <div>
                        Net income this year {usd(l.netIncomeYr)} · losses since inception {usd(l.chargeOffsTotal)}
                        {l.yours > 0 && <> · you are {(conc * 100).toFixed(2)}% of their book</>}
                        {conc > 0.06 && <span className="neg"> — big enough that your problems are theirs</span>}
                      </div>
                      <div style={{ marginTop: 6 }}>
                        {l.failedM !== undefined
                          ? "In receivership. Loans they wrote still have to be repaid; nothing new is being written, ever."
                          : l.appetite < 0.12
                            ? "Not quoting. Nothing you bring them gets underwritten until the capital comes back."
                            : l.appetite < 0.6
                              ? `Rationing — the advance rate on anything they write is about ${(100 * Math.min(1.02, 0.55 + 0.45 * l.appetite)).toFixed(0)}% of their stated sheet, and the coupon carries about ${(Math.max(0, 1 - l.appetite) * 80).toFixed(0)}bps of extra spread.`
                              : "Writing at their stated terms."}
                      </div>
                      {(() => {
                        const book = bankStatement(game, parcels, l.name);
                        const cityTotal = book.reduce((a, r) => a + r.balance, 0);
                        const target = targetCapital(l.name);
                        const nim = (l.bookYield ?? 0) - Math.max(0, l.fundCost ?? 0);
                        const byClass: Record<string, number> = {};
                        const byDistrict: Record<string, number> = {};
                        for (const r of book) {
                          byClass[r.klass] = (byClass[r.klass] ?? 0) + r.balance;
                          byDistrict[r.district] = (byDistrict[r.district] ?? 0) + r.balance;
                        }
                        const classCap = l.kind === "bank" ? 0.45 : l.kind === "life" ? 0.55 : l.kind === "conduit" ? 0.65 : 1;
                        const shares = Object.entries(byClass).sort((a, b) => b[1] - a[1]);
                        const districts = Object.entries(byDistrict).sort((a, b) => b[1] - a[1]).slice(0, 3);
                        const full = cityTotal > 40_000_000 ? shares.filter(([, v]) => classCap < 1 && v / cityTotal > classCap) : [];
                        const stranded = book.filter((r) => r.yours && h.bad && r.matM - game.month <= 60);
                        return (
                          <div style={{ marginTop: 10, paddingLeft: 12, borderLeft: "2px solid rgba(120,100,70,0.28)" }}>
                            {l.bookYield !== undefined && l.fundCost !== undefined && l.failedM === undefined && (
                              <div style={{ marginBottom: 6 }}>
                                The book earns <b className="mono">{l.bookYield.toFixed(2)}%</b> against funding at{" "}
                                <b className="mono">{Math.max(0, l.fundCost).toFixed(2)}%</b> — a{" "}
                                <b className={"mono" + (nim < 1.5 ? " neg" : "")}>{nim.toFixed(2)}pt</b> margin.{" "}
                                {nim < 1.5
                                  ? <span className="neg">The funding has repriced and the book has not. This is how a lender dies without writing a single bad loan — the advance rates go first.</span>
                                  : nim < 2.5
                                    ? "Compressed — loans written in a cheaper era against money priced in this one. They ration before it heals."
                                    : "A healthy spread; the desk earns its way out of ordinary losses."}
                                {(l.divYr ?? 0) > 0 && <span className="dim"> Paid {usd(l.divYr!)} out to the owners this year — capital above the buffer does not sit.</span>}
                              </div>
                            )}
                            {(l.capHist?.length ?? 0) > 1 && (
                              <div style={{ marginBottom: 6 }}>
                                <CapSpark hist={l.capHist} target={target} />
                                <span className="dim" style={{ marginLeft: 8 }}>
                                  capital ratio, quarterly · the dashed line is their {(target * 100).toFixed(1)}% target — a desk
                                  walking toward it is a desk to refinance away from
                                </span>
                              </div>
                            )}
                            {cityTotal > 0 && (
                              <div style={{ marginBottom: 6 }}>
                                <span className="dim">In this town: </span>
                                {shares.map(([k, v]) => `${k} ${(100 * v / cityTotal).toFixed(0)}%`).join(" · ")}
                                {districts.length > 1 && <span className="dim"> — by district {districts.map(([k, v]) => `${k} ${(100 * v / cityTotal).toFixed(0)}%`).join(", ")}</span>}
                                {full.length > 0 && (
                                  <span className="neg"> — full on {full.map(([k]) => k).join(" and ")} against their {(classCap * 100).toFixed(0)}% limit; new paper in that class is cut, whoever brings it</span>
                                )}
                              </div>
                            )}
                            {book.length > 0 && (
                              <>
                                <div style={{ margin: "8px 0 4px", letterSpacing: "0.04em", textTransform: "uppercase", fontSize: "0.82em" }}>
                                  The loan book — {book.length} loan{book.length === 1 ? "" : "s"} against deeds in this town, {usd(cityTotal)}
                                </div>
                                <table className="tbl">
                                  <thead>
                                    <tr>
                                      <th>Property</th><th>Borrower</th><th className="num">Balance</th><th className="num">Rate</th>
                                      <th className="num">Maturity</th><th className="num">LTV then → now</th><th>Standing</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {book.map((r) => {
                                      const yrs = (r.matM - game.month) / 12;
                                      return (
                                        <tr key={r.bbl} onClick={(e) => { e.stopPropagation(); focus(r.bbl, true); }}
                                          style={{ cursor: "pointer", ...(r.yours ? { background: "rgba(120,100,70,0.10)" } : {}) }}>
                                          <td>{resolveRec(parcels, game, r.bbl)?.address ?? r.bbl}{r.dev && <span className="dim"> · under construction</span>}</td>
                                          <td className={r.yours ? "" : "dim"}>{r.borrower}</td>
                                          <td className="num">{usd(r.balance)}</td>
                                          <td className="num">{r.rate > 0 ? r.rate.toFixed(2) + "%" : "—"}</td>
                                          <td className={"num" + (yrs <= 2 && !r.dev && r.yours ? " neg" : "")}>{monthLabel(r.matM)}</td>
                                          <td className="num">
                                            {r.origLtv !== null ? `${(100 * r.origLtv).toFixed(0)}%` : "—"}
                                            {" → "}
                                            {r.curLtv !== null
                                              ? <span className={r.curLtv > 1 ? "neg" : undefined}>{(100 * r.curLtv).toFixed(0)}%</span>
                                              : "—"}
                                          </td>
                                          <td className={r.bad ? "neg" : "dim"}>
                                            {r.dev ? "takeout at delivery"
                                              : r.status === "current" && yrs <= 2 ? `${Math.max(0, yrs).toFixed(1)} yrs`
                                                : r.status}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </>
                            )}
                            {l.book > cityTotal && (
                              <div className="dim" style={{ marginTop: 4 }}>
                                Plus {usd(l.book - cityTotal)} lent outside this town. The examiners see that book; you cannot —
                                the delinquency figure above is the only window into it.
                              </div>
                            )}
                            {stranded.length > 0 && (
                              <div className="alarm" style={{ marginTop: 6 }}>
                                {stranded.length === 1 ? "One balloon" : `${stranded.length} balloons`} of yours inside five years
                                at a desk that is {h.word}. A maturity here is a maturity that may not get refinanced —
                                move it while somebody else is still quoting.
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {yoursTotal > 0 && (
        <div className="hint">
          You owe {usd(yoursTotal)} across these desks. Where it sits matters as much as what it costs: a
          maturity at an impaired lender is a maturity that does not get refinanced.
        </div>
      )}
    </>
  );
}

// What the lending market remembers about you. Only shown once there is
// something to remember — a clean sponsor does not need to be told they are
// clean, and an empty panel is noise.
export function SponsorRecord() {
  const game = useStore((s) => s.game)!;
  const st = sponsorStanding(game);
  const events = (game.sponsor?.events ?? []).filter((e) => game.month - e.m < 120);
  if (!events.length) return null;
  return (
    <div className="deal">
      <div className="deal-head">Your record with the desks · {st.label}</div>
      <div className="roll">
        {events.slice().reverse().map((e, i) => (
          <div key={i} className="roll-row">
            <span className="roll-name">
              {e.kind === "deficiency" ? "Deficiency paid" : e.kind === "seized" ? "Seized by creditors" : "Sold under pressure"} · {e.address}
            </span>
            <span className="roll-meta mono">
              {monthLabel(e.m)}{e.amount > 0 ? ` · $${(e.amount / 1e6).toFixed(2)}M hole` : ""} · ages off {monthLabel(e.m + 120)}
            </span>
          </div>
        ))}
      </div>
      <div className="deal-note">
        {st.institutional
          ? `Priced in: about +${st.spreadAdd.toFixed(2)}% on the coupon and ${(st.advanceCut * 100).toFixed(0)}% off the advance rate, on every loan you write until it ages off.`
          : `Agency and insurance money is closed to you. Bridge and mezzanine desks will still quote — at about +${st.spreadAdd.toFixed(2)}% and ${(st.advanceCut * 100).toFixed(0)}% less proceeds.`}
      </div>
    </div>
  );
}

// THE STREET. Who else is buying, what they own, and how much rope they have
// left. This is not decoration: the appetite number at the top is the same one
// that decides whether your lowball gets refused, and a firm sliding toward
// its covenants is a firm whose buildings are about to be cheap.
/**
 * WHAT HAS ACTUALLY TRADED.
 *
 * Everything else on this page is the engine telling you what it thinks. This
 * is the only panel in the game built entirely out of things that happened:
 * closed sales, the price paid, the cap rate that price implies, and the names
 * on both sides. Forming a view out of prints rather than out of a stat block
 * is most of the job, and there was no way to do it.
 */
export function CompsSheet() {
  const game = useStore((s) => s.game)!;
  const select = useStore((s) => s.select);
  const setPage = useStore((s) => s.setPage);
  const [win, setWin] = useState(60);
  const comps = game.comps ?? [];
  if (comps.length < 3) {
    return (
      <>
        <div className="page-section">Comparable sales</div>
        <div className="hint">Nothing has changed hands yet that is worth calling a comp. Come back once the market has printed a few.</div>
      </>
    );
  }
  const recent = [...comps].reverse().filter((c) => c.m >= game.month - win).slice(0, 40);
  const flows = compFlows(game, win).slice(0, 8);
  return (
    <>
      <div className="page-section">
        Comparable sales · {recent.length} in the last {win / 12} years
      </div>
      <div className="hint">
        Closed prices, not appraisals. The cap rate is the going-in yield on what the buyer actually paid — when it
        drifts down across a class, the market is repricing and your own book is worth more than the tape says.
      </div>
      <div className="btn-row" style={{ marginBottom: 8 }}>
        {[36, 60, 120, 300].map((w) => (
          <button key={w} className={"btn-mini" + (win === w ? " on" : "")} onClick={() => setWin(w)}>
            {w / 12} yr
          </button>
        ))}
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Class</th><th className="num">Trades</th><th className="num">Median cap</th>
            <th className="num">Median $/sf</th><th className="num">Volume</th><th className="num">Distressed</th>
          </tr>
        </thead>
        <tbody>
          {(["office", "retail", "multifamily", "industrial", "land"] as const).map((k) => {
            const st = compStats(game, k, win);
            return (
              <tr key={k}>
                <td>{k === "land" ? "Land" : CLASS_LABEL[k]}</td>
                {st ? (
                  <>
                    <td className="num">{st.n}</td>
                    <td className="num">{k === "land" ? "—" : `${st.medCap.toFixed(2)}%`}</td>
                    <td className="num">${st.medPsf.toFixed(0)}{k === "land" ? " lot" : ""}</td>
                    <td className="num">{usd(st.volume)}</td>
                    <td className={"num" + (st.distressShare > 0.3 ? " neg" : "")}>{(st.distressShare * 100).toFixed(0)}%</td>
                  </>
                ) : (
                  <td colSpan={5} className="dim">too few prints to call it a market</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* THE TAPE'S YARDSTICK. The table above says where the median print
          cleared; this says where the market's own asking yields have been for
          twenty years, class by class — a print is only rich or cheap AGAINST
          this line, and until now holding the line in your head meant flipping
          back to the Economy page between rows. */}
      {(() => {
        const hist = (game.econ.history ?? []).slice(-240);
        if (hist.length < 2) return null;
        const KL = ["office", "retail", "multifamily", "industrial"] as const;
        const C: Record<(typeof KL)[number], string> = { office: "#3d6f9e", retail: "#a8562e", multifamily: "#4a7d5a", industrial: "#7a6a45" };
        return (
          <>
            <div className="page-section" style={{ marginTop: 14 }}>Cap rates — twenty years, by class</div>
            <LineChart height={132}
              series={KL.map((k) => ({ label: CLASS_LABEL[k], color: C[k], pts: hist.map((h) => h.cap?.[k] ?? game.econ.capRate[k]) }))}
              yFmt={(v) => `${v.toFixed(1)}%`}
              xLabels={[monthLabel(hist[0].q), monthLabel(hist[hist.length - 1].q)]}
            />
            <div className="hint">
              {KL.map((k) => (
                <span key={k} style={{ marginRight: 14, whiteSpace: "nowrap" }}>
                  <span style={{ display: "inline-block", width: 12, height: 3, background: C[k], verticalAlign: "middle", marginRight: 5 }} />
                  {CLASS_LABEL[k]}
                </span>
              ))}
              — a print well above its line bought a problem or a bargain; below it, somebody paid up. When a
              whole line drifts down, the market is repricing and your own book is worth more than the tape
              says yet.
            </div>
          </>
        );
      })()}

      {/* WHO IS DOING WHAT. A shop that has bought nine buildings in eighteen
          months is levering into the top, and you can watch them do it. */}
      {flows.length > 0 && (
        <>
          <div className="page-section" style={{ marginTop: 14 }}>Who has been active</div>
          <table className="tbl">
            <thead>
              <tr><th>Firm</th><th className="num">Bought</th><th className="num">Sold</th><th className="num">Net</th><th>Read</th></tr>
            </thead>
            <tbody>
              {flows.map((f) => (
                <tr key={f.name} className={f.name === firmShort(game) ? "row-me" : ""}>
                  <td>{f.name}</td>
                  <td className="num">{f.boughtN ? `${f.boughtN} · ${usd(f.bought)}` : "—"}</td>
                  <td className="num">{f.soldN ? `${f.soldN} · ${usd(f.sold)}` : "—"}</td>
                  <td className={"num" + (f.net < 0 ? " neg" : "")}>{f.net >= 0 ? "+" : "−"}{usd(Math.abs(f.net))}</td>
                  <td className="dim">
                    {f.boughtN >= 4 && f.net > 0 ? "Buying hard. They are the bid you are up against."
                      : f.soldN >= 3 && f.net < 0 ? "Getting out. Ask why before you buy what they are selling."
                      : f.net > 0 ? "Net buyer" : f.net < 0 ? "Net seller" : "Even"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="page-section" style={{ marginTop: 14 }}>Recent prints</div>
      <div style={{ overflowX: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Closed</th><th>Property</th><th>Class</th><th className="num">Price</th>
              <th className="num">$/sf</th><th className="num">Cap</th><th>Buyer</th><th>Seller</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((c, i) => (
              <tr key={c.bbl + c.m + i} className={c.distress ? "dim" : ""}
                style={{ cursor: "pointer" }}
                onClick={() => { setPage("none"); select(c.bbl); }}>
                <td className="mono">{monthLabel(c.m)}</td>
                <td>{c.address}{c.distress ? " · distressed" : ""}</td>
                <td className="dim">{CLASS_LABEL[c.cls as keyof typeof CLASS_LABEL] ?? c.cls}</td>
                <td className="num">{usd(c.price)}</td>
                <td className="num">{c.sf > 0 ? `$${c.psf.toFixed(0)}` : `$${c.psf.toFixed(0)} land`}</td>
                <td className="num">{c.capRate > 0 ? `${c.capRate.toFixed(2)}%` : "—"}</td>
                <td className={c.buyer === firmShort(game) ? "" : "dim"}>{c.buyer}</td>
                <td className={c.seller === firmShort(game) ? "" : "dim"}>{c.seller}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

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
  const playerEquity = (() => {
    let v = game.cash;
    for (const h of Object.values(game.holdings)) {
      const rec = resolveRec(parcels, game, h.bbl);
      if (rec) v += holdingValue(rec, game.econ, h, game.month) - (h.loan?.balance ?? 0);
    }
    return v;
  })();
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
        that bid is you. Click any firm for its balance sheet and what it owns.
      </div>
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
            <th>Firm</th><th>Style</th><th className="num">Buildings</th><th className="num">Gross assets</th>
            <th className="num">Debt</th><th className="num">Net equity</th>
            <th className="num">Leverage</th><th className="num">Dry powder</th><th>Read</th>
          </tr>
        </thead>
        <tbody>
          {marked.map(({ r, m }) => {
            const dead = r.failedM !== undefined;
            const stress = (r.stressMs ?? 0) > 0;
            const isOpen = open === r.id;
            return (
              <Fragment key={r.id}>
              <tr className={dead ? "dim" : ""} style={{ cursor: "pointer" }}
                onClick={() => setOpen(isOpen ? null : r.id)}>
                <td>{isOpen ? "▾ " : "▸ "}{r.name}</td>
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
              {isOpen && (
                <tr>
                  <td colSpan={9} style={{ background: "rgba(43,37,26,0.035)" }}>
                    {/* THE BALANCE SHEET, the same one you are judged on. Gross
                        assets less debt is their equity; NOI over assets is what
                        the book yields; distributions are what they have already
                        taken off the table, which is why a firm with modest
                        equity is not necessarily a firm that did badly. */}
                    <div className="grid" style={{ margin: "8px 0" }}>
                      <Row k="Gross assets" v={usd(m.aum)} />
                      <Row k="Debt" v={usd(r.debt)} bad={m.ltv > 0.8} />
                      <Row k="Equity in property" v={usd(m.aum - r.debt)} bad={m.aum - r.debt < 0} />
                      <Row k="Cash" v={usd(r.cash)} bad={r.cash < 0} />
                      {/* the number the league table ranks on, and the same one
                          your own Books page calls net worth */}
                      <Row k="Net worth" v={usd(rivalEquity(m, r))} strong bad={rivalEquity(m, r) < 0} />
                      <Row k="Leverage" v={`${(m.ltv * 100).toFixed(0)}% LTV · they stop at ${(STYLE_MAX[r.style] * 100).toFixed(0)}%`} bad={m.ltv > STYLE_MAX[r.style]} />
                      <Row k="NOI / yr" v={usd(m.noiYr)} />
                      <Row k="Yield on assets" v={m.aum > 0 ? `${((m.noiYr / m.aum) * 100).toFixed(2)}%` : "—"} />
                      {/* THE PART OF A COMPETITOR YOU COULD NEVER SEE. Their
                          buildings fill and empty and wear out like yours do,
                          and a firm running 74% full with a deferred capital
                          plan is a seller waiting for a reason. */}
                      {r.occ !== undefined && (
                        <Row k="Portfolio occupancy" v={`${(r.occ * 100).toFixed(0)}%`} bad={r.occ < 0.8} />
                      )}
                      <Row k="Condition of the book"
                        v={`${CONDITION_WORD[rivalCondition(r)]} · ${usd(r.capexYr ?? 0)} of capital spent this year`}
                        bad={(r.condIdx ?? 1) < 0.55} />
                      {game.street?.[r.id] && (
                        <Row k="Between you"
                          v={[
                            game.street[r.id].deals ? `${game.street[r.id].deals} deal${game.street[r.id].deals === 1 ? "" : "s"}` : null,
                            game.street[r.id].beats ? `outbid you ${game.street[r.id].beats}×` : null,
                            game.street[r.id].insults ? `${game.street[r.id].insults} conversation${game.street[r.id].insults === 1 ? "" : "s"} you ended badly` : null,
                          ].filter(Boolean).join(" · ") || "nothing yet"}
                          bad={(game.street[r.id].insults ?? 0) > 0} />
                      )}
                      <Row k="Debt service / yr" v={`−${usd((r.debt * (game.econ.indexRate + 1.9)) / 100 + r.debt / 30)}`} />
                      {/* realised, and no longer on this balance sheet — which
                          is why modest equity is not the same as a bad century */}
                      <Row k="Taken out to date" v={usd(r.distributed ?? 0)} />
                      <Row k="Founded" v={r.bornM > 0 ? monthLabel(r.bornM) : "before you arrived"} />
                    </div>
                    {/* WHAT THEY HAVE IN THE GROUND. A firm's live jobs are the
                        part of its balance sheet that is pure risk: money spent,
                        debt drawn, nothing earning. It is also the space that is
                        coming for your tenants in two years. */}
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
                    <div className="page-section" style={{ marginTop: 4 }}>
                      What they own · {r.bbls.length}
                    </div>
                    {r.bbls.length === 0 && <div className="hint">Nothing. All cash, looking.</div>}
                    {/* EVERY DEED, not the first sixty. A truncated list of a
                        competitor's holdings is worse than none: it looks
                        complete and it is not, and you cannot see what somebody
                        is quietly assembling from a page that stops early.
                        Sorted by value, because that is how a book is read. */}
                    <div className="mini-list">
                      {r.bbls.map((b) => {
                        const rec = resolveRec(parcels, game, b);
                        if (!rec) return null;
                        return { b, rec, v: assetValue(rec, game.econ, initialCondition(rec)) };
                      }).filter(Boolean).sort((a, b2) => b2!.v - a!.v).map((row) => (
                        <button key={row!.b} className="neighbor"
                          onClick={(ev) => { ev.stopPropagation(); focus(row!.b, true); }}>
                          <span className="neighbor-addr">{row!.rec.address}</span>
                          <span className="neighbor-meta">
                            {row!.rec.class === "land" ? "vacant land" : `${useLabel(row!.rec)} · ${sf(row!.rec.bldgArea)}`} · {usd(row!.v)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

// where each style stops borrowing — mirrored from the engine so the sheet can
// say what their own covenant is, not just where they are against it
export const STYLE_MAX: Record<string, number> = {
  family: 0.50, core: 0.65, opportunistic: 0.88, developer: 0.78,
  merchant: 0.80, pe: 0.75, reit: 0.58, vulture: 0.60,
  owneruser: 0.55, foreign: 0.35, slumlord: 0.72,
};

export const CONDITION_WORD: Record<string, string> = {
  good: "well kept", standard: "adequate", worn: "run down", obsolete: "finished",
};

// What the street calls each kind of shop. The point of the phrasing is that
// it tells you what they WANT, because that is what decides whether they are
// your competition on this building or your buyer for it next year.
export const STYLE_WORD: Record<string, string> = {
  family: "old money",
  core: "institutional",
  opportunistic: "opportunistic",
  developer: "developer",
  merchant: "merchant builder",
  pe: "private equity · IRR clock",
  reit: "listed REIT",
  vulture: "distressed specialist",
  owneruser: "owner-occupier",
  foreign: "offshore capital",
  slumlord: "milking the stock",
};


// The revolving line: up to 35% of net worth at prime + 400bps, and the
// advance rate moves with the credit cycle — the label used to promise a
// fixed 35% while the engine was quietly cutting it in a crunch. It draws
// before a shortfall becomes insolvency, and idle cash sweeps against it.
export function CreditLine() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const { drawCredit, repayCredit } = useStore.getState();
  const limit = locLimit(game, parcels);
  const nw = netWorth(game, parcels);
  const balance = game.loc?.balance ?? 0;
  const avail = Math.max(0, limit - balance);
  const rate = locRate(game);
  const [amt, setAmt] = useState(0);
  const room = Math.max(avail, balance);
  return (
    <div className="page-section">
      <div className="page-section-head">Line of credit</div>
      <div className="stat-strip">
        {(() => {
          const adv = nw > 0 ? limit / nw : 0.35;
          return (
            <Big
              label={`Limit · ${(adv * 100).toFixed(0)}% of net worth`}
              value={usd(limit)}
              bad={adv < 0.3}
            />
          );
        })()}
        <Big label="Drawn" value={usd(balance)} bad={balance > limit * 0.8} />
        <Big label="Available" value={usd(avail)} />
        <Big label="Rate · index + 400" value={pct(rate)} />
        <Big label="Interest paid" value={usd(game.loc?.interestPaid ?? 0)} />
      </div>
      <SponsorRecord />
      {room > 0 ? (
        <>
          <Slider
            label="Amount"
            value={Math.min(amt, room)}
            min={0}
            max={Math.max(1, room)}
            step={Math.max(10_000, Math.round(room / 200))}
            onChange={setAmt}
            format={(v) => usd(v)}
            marks={[
              { at: Math.round(room * 0.25), label: "¼" },
              { at: Math.round(room * 0.5), label: "½" },
              { at: room, label: "all" },
            ]}
            hint={`Costs ${usd((Math.min(amt, room) * rate) / 100 / 12)} a month in interest while it's out.`}
          />
          <div className="btn-row">
            <button className="btn btn-buy" disabled={amt <= 0 || amt > avail} onClick={() => drawCredit(amt)}>
              Draw {usd(Math.min(amt, avail))}
            </button>
            <button className="btn" disabled={balance <= 0 || amt <= 0} onClick={() => repayCredit(amt)}>
              Repay {usd(Math.min(amt, balance))}
            </button>
          </div>
        </>
      ) : (
        <div className="hint">Build some net worth and the bank will open a line against it.</div>
      )}
      <div className="hint">
        The line covers a shortfall automatically before it can sink the run, and idle cash above $250K pays it back down.
      </div>
    </div>
  );
}

/**
 * The saves page. The slot manager used to live at the bottom of the Books
 * page, below the ledger and the milestone list, which is why nobody knew the
 * game could be saved at all. Loading a game is not an accounting task.
 */
/**
 * SETTINGS. The first thing in here exists because of a sentence from the
 * owner: "sometimes I want to simulate the game" — twenty years of Advance
 * with nothing taking the screen hostage. Every pop-up decision also lives on
 * a page, so the master switch costs nothing but the interruptions. The other
 * rows are the switches that already existed, gathered where a person would
 * look for them.
 */
/**
 * THE ONE PAGE THAT ASSUMES YOU HAVE NEVER DONE THIS.
 *
 * Every other screen in this game is written for somebody who already knows
 * what a cap rate is — the tooltips explain what a NUMBER means, not what the
 * IDEA is, which is only useful once you have the idea. The owner asked for
 * "very basic", and the test applied here is that a reader who has never heard
 * the words should be able to buy their first building afterwards and know why.
 *
 * It uses the player's OWN market for the worked example rather than invented
 * round numbers, because a primer that says "imagine a 7% cap" and a game
 * showing 8.34% has just taught somebody that the primer is not about this.
 * Three ideas, in the order they depend on each other — the income, the yield,
 * the value — and then the two traps that follow from them.
 */

export function HousePolicy() {
  const game = useStore((s) => s.game)!;
  const { opsPolicy } = useStore.getState();
  const cur = game.opsPolicy ?? { service: 0 as const, plan: 1 as const, stance: 0 as const };
  const [svc, setSvc] = useState<-1 | 0 | 1>(cur.service);
  const [pln, setPln] = useState<0 | 1 | 2>(cur.plan);
  const [stn, setStn] = useState<-1 | 0 | 1>(cur.stance ?? 0);
  const built = Object.values(game.holdings).filter((h) => {
    const rec = useStore.getState().parcels?.[h.bbl];
    return rec && rec.class !== "land";
  });
  const off = built.filter((h) => (h.stance ?? 0) !== stn || (h.service ?? 0) !== svc || (h.plan ?? 1) !== pln).length;
  const commercial = built.filter((h) => {
    const rec = useStore.getState().parcels?.[h.bbl];
    return rec && isCommercial(rec);
  });
  const commercialN = commercial.length;
  const onHouse = commercial.filter((h) => h.broker).length;
  const dirty = svc !== cur.service || pln !== cur.plan || stn !== (cur.stance ?? 0);
  const Seg = <T extends number>(
    { label, value, set, opts, hint }:
    { label: string; value: T; set: (v: T) => void; opts: { k: T; label: string; title: string }[]; hint: string },
  ) => (
    <>
      <div className="grid"><Row k={label} v={opts.find((o) => o.k === value)?.label ?? "—"} /></div>
      <div className="btn-row">
        {opts.map((o) => (
          <button key={String(o.k)} className={"btn" + (value === o.k ? " btn-on" : "")}
            title={o.title} onClick={() => set(o.k)}>{o.label}</button>
        ))}
      </div>
      <div className="hint">{hint}</div>
    </>
  );
  return (
    <div className="page-section">
      <div className="page-section-head">
        How the house runs buildings · {built.length} propert{built.length === 1 ? "y" : "ies"}
      </div>
      <div className="hint" style={{ marginTop: 0 }}>
        Set it once. It applies to every deed you close from here on, and to the book you already own.
        A building that needs different treatment is still set on its own card, and that override stands.
      </div>
      <Seg label="The ask on new leases" value={stn} set={setStn}
        opts={[
          { k: -1 as const, label: "Fill space", title: "−8% asking rents, and the letters come faster" },
          { k: 0 as const, label: "Market", title: "ask what the market is asking" },
          { k: 1 as const, label: "Push rents", title: "+8% asking rents, and fewer letters arrive" },
        ]}
        hint="Eight per cent either way on the ask, and the traffic moves against you harder than the rent moves for you — that is the trade, and it is why pushing rents into a soft market empties a building." />
      <Seg label="Service" value={svc} set={setSvc}
        opts={OPS_SERVICE.map((o) => ({ k: o.key, label: o.label, title: o.blurb }))}
        hint="Free to change and slow to matter: the saving lands next month and the tenants have not noticed for three years — which is exactly why cutting it is a trap rather than a lever." />
      <Seg label="Capital plan" value={pln} set={setPln}
        opts={OPS_PLAN.map((o) => ({ k: o.key, label: o.label, title: o.blurb }))}
        hint="Deferring is free today and ruinous over a twenty-year hold. It is sometimes right — for a flip, or for a building you are emptying to knock down." />
      <div className="btn-row">
        <button className="btn btn-buy" disabled={!dirty && off === 0}
          onClick={() => opsPolicy({ service: svc, plan: pln, stance: stn })}>
          {off > 0 ? `Apply to all ${built.length} buildings` : "Applied"}
        </button>
      </div>
      {/* WHO WORKS THE PHONES, ALSO ONCE. Same argument as the three above: an
          exclusive is a standing decision about how the book is run, and it was
          twenty clicks for one policy. Flats are skipped rather than refused —
          a mixed book is the normal case and the engine already says a broker
          does not work multifamily. */}
      <div className="grid" style={{ marginTop: 8 }}>
        <Row k="Leasing exclusive" v={`${onHouse} of ${commercialN} commercial building${commercialN === 1 ? "" : "s"} with the house`} />
      </div>
      <div className="btn-row">
        <button className="btn" disabled={commercialN === 0 || onHouse === commercialN}
          onClick={() => useStore.getState().brokerAll(true)}>
          Put the whole book on the house
        </button>
        <button className="btn" disabled={onHouse === 0}
          onClick={() => useStore.getState().brokerAll(false)}>
          End every exclusive
        </button>
      </div>
      <div className="hint">
        No retainer and nothing while the space sits — they are paid 6% of the base rent over the term of
        everything they sign, at the signing, against the 4% on a new lease and 2% on a renewal your own people
        cost. Cheap to hold, expensive when it works, and the right answer changes with how much of the book is
        empty.
      </div>
      <div className="hint">
        {off === 0
          ? "Every building on the book is running this policy."
          : `${off} of ${built.length} ${off === 1 ? "building is" : "buildings are"} running something else — either an override you set deliberately, or a policy you changed after you bought them.`}
      </div>
    </div>
  );
}

// Everything about who is paying you rent, in one room: occupancy by
// building, the whole rent roll, what rolls when, and the agent switch.
/**
 * THE DEBT PAGE — the whole balance sheet's borrowing on one screen.
 *
 * Every number here existed somewhere before and none of them existed
 * together. A player wanting to know what their book actually owed had to open
 * every building in turn, read a loan card each, and hold the weighted average
 * coupon in their head — which is not a thing anybody does, so nobody knew
 * their own WAM, their fixed/floating split, or how much was maturing in the
 * next three years until a balloon landed on them.
 *
 * The order is the order a lender's credit memo puts them in: what you owe,
 * what it costs, what covers it, when it comes due, and what could go wrong.
 */
/**
 * THE LANDLORDS — the names behind the nine buildings in ten that no firm owns.
 *
 * The complaint that produced this was that the owners of the fifty biggest
 * buildings in town all read "private", which is not a fact about a city, it is
 * a missing one. `The street` lists the operating firms you compete with; this
 * lists the people you BUY FROM, which in any real market is a different and
 * much larger set. Sorted by square footage, because that is the order in which
 * they matter to you.
 *
 * Every column is a fact you can act on: how much they hold, how long they have
 * been here, what kind of counterparty they are — and where you stand with
 * them, which is the one that decides whether the phone gets answered.
 */
export function Landlords() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const rows = useMemo(() => {
    const by = new Map<string, { h: ReturnType<typeof holderOf>; n: number; sf: number; val: number }>();
    for (const bbl of Object.keys(parcels)) {
      const held = holderOf(game, parcels, bbl);
      if (!held) continue;
      const rec = resolveRec(parcels, game, bbl);
      if (!rec) continue;
      const e = by.get(held.id) ?? { h: held, n: 0, sf: 0, val: 0 };
      e.n++;
      e.sf += rec.bldgArea ?? 0;
      e.val += assetValue(rec, game.econ, gradeOf(game, rec));
      by.set(held.id, e);
    }
    return [...by.values()].sort((a, b) => b.sf - a.sf);
  }, [game, parcels]);
  const totSf = rows.reduce((a, r) => a + r.sf, 0);
  const top10 = rows.slice(0, 10).reduce((a, r) => a + r.sf, 0);

  return (
    <div>
      <div className="hint">
        {rows.length} private holders own {sf(totSf)} between them — the ten biggest hold{" "}
        {totSf > 0 ? ((top10 / totSf) * 100).toFixed(0) : 0}% of it. These are not your competitors;
        they are who you buy from, and most of them have been here longer than you have.
      </div>
      <div className="scroll-x">
        <table className="tbl">
          <thead>
            <tr>
              <th>Holder</th><th>Kind</th><th className="num">Buildings</th><th className="num">Square feet</th>
              <th className="num">Est. value</th><th className="num">Since</th><th>Where you stand</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 40).map((r) => {
              const cold = isCold(game, r.h!.id);
              const rel = relOf(game, r.h!.id);
              return (
                <tr key={r.h!.id} title={r.h!.note}>
                  <td>{r.h!.name}</td>
                  <td className="dim">{r.h!.kind}</td>
                  <td className="num">{r.n}</td>
                  <td className="num">{sf(r.sf)}</td>
                  <td className="num">{usd(r.val)}</td>
                  <td className="num dim">{r.h!.since}</td>
                  <td className={cold ? "neg" : (rel.deals ?? 0) > 0 ? "" : "dim"}>
                    {standingWith(game, r.h!.id)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="hint">
        An offer somebody finds insulting is not filed against the building — it is filed against THEM, and
        they own the other four. That is what the last column is for.
      </div>
    </div>
  );
}

export function DebtPage() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const { releaseFacility, repayFacility: payFac } = useStore.getState();
  // WHICH LOAN HAS ITS REFINANCING OPEN. The debt page is where a borrower
  // decides what to do about their debt, and until now the only door to the
  // refinance desk was the property record or a row on the portfolio — two
  // screens away from the maturity ladder that tells you which loan needs it.
  const [refiRow, setRefiRow] = useState<string | null>(null);
  const [pool, setPool] = useState<string[]>([]);
  const [prod, setProd] = useState<string>("savings");
  const [lev, setLev] = useState(1);
  const [building, setBuilding] = useState(false);

  const rows = Object.values(game.holdings)
    .map((h) => {
      const rec = resolveRec(parcels, game, h.bbl);
      return {
        h, rec,
        v: rec ? holdingValue(rec, game.econ, h, game.month) : 0,
        noi: rec ? holdingNOIYr(rec, game.econ, h, game.month) : 0,
      };
    })
    .filter((r) => r.rec);

  // ---- the aggregates, which is the point of the page ----------------------
  const agg = (() => {
    let bal = 0, wRate = 0, wam = 0, flo = 0, wall36 = 0, ds = 0, noi = 0, val = 0, recourseBal = 0;
    let ioBal = 0, n = 0;
    for (const { h, v, noi: nn } of rows) {
      val += v; noi += nn;
      const l = h.loan;
      if (!l) continue;
      n++;
      bal += l.balance;
      wRate += l.balance * l.ratePct;
      wam += l.balance * Math.max(0, (l.maturityM - game.month) / 12);
      if (l.floating ?? l.product === "float") flo += l.balance;
      if (l.maturityM - game.month <= 36) wall36 += l.balance;
      if (game.month < l.ioUntilM) ioBal += l.balance;
      if (productById(l.product).recourse) recourseBal += l.balance;
      ds += l.monthlyPmt * 12;
    }
    const f = game.facility;
    if (f) {
      n++;
      bal += f.balance;
      wRate += f.balance * f.ratePct;
      wam += f.balance * Math.max(0, (f.maturityM - game.month) / 12);
      if (f.maturityM - game.month <= 36) wall36 += f.balance;
      if (game.month < f.ioUntilM) ioBal += f.balance;
      if (f.recourse) recourseBal += f.balance;
      ds += f.monthlyPmt * 12;
    }
    // Construction facilities are debt too, and they are the debt most likely
    // to be forgotten: they are drawn a bit at a time and they balloon on
    // delivery, which is exactly when the building earns nothing.
    let cons = 0, consDs = 0;
    for (const d of Object.values(game.developments ?? {})) {
      cons += d.loanBalance;
      consDs += (d.loanBalance * d.ratePct) / 100;
    }
    const loc = game.loc?.balance ?? 0;
    const locDs = (loc * locRate(game)) / 100;
    const total = bal + cons + loc;
    return {
      bal, cons, loc, total, n,
      rate: bal > 0 ? wRate / bal : 0,
      wam: bal > 0 ? wam / bal : 0,
      floShare: bal > 0 ? flo / bal : 0,
      ioShare: bal > 0 ? ioBal / bal : 0,
      recourseShare: bal > 0 ? recourseBal / bal : 0,
      wall36, val, noi,
      ds: ds + consDs + locDs,
      ltv: val > 0 ? total / val : 0,
      dscr: ds + consDs + locDs > 0 ? noi / (ds + consDs + locDs) : null,
      dy: total > 0 ? noi / total : null,
    };
  })();

  // ---- the maturity ladder, by calendar year -------------------------------
  const ladder = (() => {
    const by = new Map<number, number>();
    const yr = (m: number) => START_YEAR + Math.floor(m / 12);
    for (const { h } of rows) if (h.loan) by.set(yr(h.loan.maturityM), (by.get(yr(h.loan.maturityM)) ?? 0) + h.loan.balance);
    if (game.facility) by.set(yr(game.facility.maturityM), (by.get(yr(game.facility.maturityM)) ?? 0) + game.facility.balance);
    for (const d of Object.values(game.developments ?? {})) {
      if (d.loanBalance > 0) by.set(yr(d.deliverM + 12), (by.get(yr(d.deliverM + 12)) ?? 0) + d.loanBalance);
    }
    return [...by.entries()].sort((a, b) => a[0] - b[0]).slice(0, 12);
  })();
  const ladderMax = Math.max(1, ...ladder.map(([, v]) => v));

  const fac = game.facility;
  const facM = facilityMetrics(game, parcels);
  const candidates = pledgeable(game, parcels);
  const quotes = building && pool.length >= FACILITY_MIN_ASSETS ? facilityQuotes(game, parcels, pool) : [];
  const qt = quotes.find((x) => x.productId === prod) ?? quotes.find((x) => x.available) ?? quotes[0];

  return (
    <div>
      <div className="stat-strip">
        <Big label="Total debt" value={usd(agg.total)} />
        <Big label="Weighted coupon" value={agg.rate > 0 ? agg.rate.toFixed(2) + "%" : "—"} />
        <Big label="Portfolio LTV" value={(agg.ltv * 100).toFixed(0) + "%"} bad={agg.ltv > 0.75} />
        <Big label="Coverage" value={agg.dscr !== null ? agg.dscr.toFixed(2) + "x" : "—"} bad={agg.dscr !== null && agg.dscr < 1.25} />
        <Big label="Debt yield" value={agg.dy !== null ? (agg.dy * 100).toFixed(1) + "%" : "—"} bad={agg.dy !== null && agg.dy < 0.08} />
        <Big label="WAM" value={agg.wam > 0 ? agg.wam.toFixed(1) + " yrs" : "—"} bad={agg.wam > 0 && agg.wam < 3} />
      </div>

      {/* WHAT IT IS MADE OF. Three different instruments with three different
          ways of hurting you, and the book showed one number for all of them. */}
      <div className="page-section">The stack</div>
      <div className="grid">
        <Row k="Mortgages" v={`${usd(agg.bal - (fac?.balance ?? 0))} across ${rows.filter((r) => r.h.loan).length} buildings`} />
        {fac && <Row k="Portfolio facility" v={`${usd(fac.balance)} across ${fac.bbls.length} deeds · ${fac.lender}`} strong />}
        <Row k="Construction" v={agg.cons > 0 ? `${usd(agg.cons)} drawn` : "none"} />
        <Row k="Line of credit" v={agg.loc > 0 ? `${usd(agg.loc)} at ${locRate(game).toFixed(2)}%` : "undrawn"} bad={agg.loc > 0} />
        <Row k="Annual debt service" v={usd(Math.round(agg.ds))} />
        <Row k="NOI against it" v={`${usd(Math.round(agg.noi))} — ${usd(Math.round(agg.noi - agg.ds))} after debt service`} bad={agg.noi - agg.ds < 0} />
      </div>

      {/* THE THREE THINGS THAT ACTUALLY END FIRMS, and none of them is the
          coupon: how much of the book reprices, how much of it is due soon,
          and how much of it you signed for personally. */}
      <div className="page-section">Where the risk is</div>
      <div className="grid">
        <Row k="Floating" v={`${(agg.floShare * 100).toFixed(0)}% of the mortgage book`} bad={agg.floShare > 0.4} />
        <Row k="Interest-only today" v={`${(agg.ioShare * 100).toFixed(0)}% — amortisation starts later and the payment steps up`} bad={agg.ioShare > 0.6} />
        <Row k="Recourse" v={`${(agg.recourseShare * 100).toFixed(0)}% you signed personally`} bad={agg.recourseShare > 0.5} />
        <Row k="Maturing inside 3 years" v={`${usd(agg.wall36)} · ${agg.bal > 0 ? ((agg.wall36 / agg.bal) * 100).toFixed(0) : 0}% of the book`} bad={agg.bal > 0 && agg.wall36 / agg.bal > 0.35} />
      </div>

      <div className="page-section">The maturity ladder</div>
      {ladder.length === 0 ? (
        <div className="hint">Nothing borrowed yet.</div>
      ) : (
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 90, marginBottom: 6 }}>
          {ladder.map(([y, v]) => (
            <div key={y} style={{ flex: 1, textAlign: "center" }} title={`${usd(v)} matures in ${y}`}>
              <div style={{
                height: Math.max(2, Math.round((v / ladderMax) * 64)),
                background: v / Math.max(1, agg.total) > 0.35 ? "#a8402e" : "#5a6f8a",
                borderRadius: 2,
              }} />
              <div className="dim mono" style={{ fontSize: 10 }}>{y}</div>
            </div>
          ))}
        </div>
      )}
      <div className="hint">
        A wall is not a number, it is a year. Anything over a third of the book landing in one of these
        is a year you have to refinance in whatever market happens to be open.
      </div>

      {/* ---- the facility ---------------------------------------------- */}
      <div className="page-section">Borrowing against the whole book</div>
      {fac ? (
        <>
          <div className="grid">
            <Row k="Status" v={facilityStatus(game, parcels)} bad={fac.breachedSince !== undefined || fac.accelM !== undefined} strong />
            <Row k="Lender" v={`${fac.lender} · ${fac.ratePct.toFixed(2)}%`} />
            <Row k="Balance" v={`${usd(fac.balance)} of ${usd(fac.drawn)} drawn`} />
            <Row k="Pool" v={`${fac.bbls.length} buildings · ${usd(Math.round(facM.value))} of value`} />
            <Row k="Pool coverage" v={facM.dscr !== null ? `${facM.dscr.toFixed(2)}x against a ${fac.minDSCR.toFixed(2)}x covenant` : "—"} bad={facM.dscr !== null && facM.dscr < fac.minDSCR} />
            <Row k="Pool leverage" v={facM.ltv !== null ? `${(facM.ltv * 100).toFixed(0)}% against a ${(fac.maxLTV * 100).toFixed(0)}% covenant` : "—"} bad={facM.ltv !== null && facM.ltv > fac.maxLTV} />
            <Row k="Payment" v={`${usd(fac.monthlyPmt)}/mo · matures ${monthLabel(fac.maturityM)}`} />
            <Row k="Recourse" v={fac.recourse ? "yes — you signed personally" : "non-recourse"} bad={fac.recourse} />
          </div>
          <div className="btn-row">
            <button className="btn" disabled={game.cash < 1_000_000} onClick={() => payFac(Math.min(fac.balance, Math.floor(game.cash * 0.5)))}>
              Pay down {usd(Math.min(fac.balance, Math.floor(game.cash * 0.5)))}
            </button>
            <button className="btn" disabled={game.cash < fac.balance} onClick={() => payFac(fac.balance)}>
              Repay in full · {usd(fac.balance)}
            </button>
          </div>
          <div className="scroll-x">
            <table className="tbl">
              <thead>
                <tr><th>Pledged</th><th className="num">Value</th><th className="num">Allocated</th><th className="num">Release price</th><th></th></tr>
              </thead>
              <tbody>
                {fac.bbls.map((b) => {
                  const rec = resolveRec(parcels, game, b);
                  const h = game.holdings[b];
                  if (!rec || !h) return null;
                  const rel = releaseCost(game, parcels, b);
                  return (
                    <tr key={b}>
                      <td>{rec.address}</td>
                      <td className="num">{usd(holdingValue(rec, game.econ, h, game.month))}</td>
                      <td className="num">{usd(allocatedAmount(game, parcels, b))}</td>
                      <td className="num">{usd(rel)}</td>
                      <td>
                        <button className="btn btn-sm" disabled={game.cash < rel} onClick={() => releaseFacility(b)}>
                          Release
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="hint">
            The pool is crossed: every deed stands behind the whole balance, a covenant breach sweeps all of them
            at once, and selling one costs its allocated share plus {Math.round((RELEASE_PREMIUM - 1) * 100)}%.
            That premium is what you pay for having borrowed against the book instead of the buildings.
          </div>
        </>
      ) : !building ? (
        <>
          <div className="hint">
            Past a handful of buildings an owner stops financing buildings and starts financing a balance sheet.
            Pledge a pool, and one lender advances against all of it: a few points more leverage and a tighter coupon
            than the same buildings borrow one at a time, because a diversified pool cannot all go dark at once.
            What you give up is separability — the pool is cross-defaulted, it is recourse, and taking a building
            back out costs a premium over its share.
          </div>
          <div className="btn-row">
            <button className="btn btn-buy" disabled={candidates.length < FACILITY_MIN_ASSETS}
              onClick={() => { setBuilding(true); setPool(candidates.slice(0, Math.min(8, candidates.length)).map((c) => c.bbl)); }}>
              {candidates.length < FACILITY_MIN_ASSETS
                ? `You need ${FACILITY_MIN_ASSETS} eligible buildings — you have ${candidates.length}`
                : "Put a pool together"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="scroll-x">
            <table className="tbl">
              <thead>
                <tr><th></th><th>Building</th><th>Class</th><th className="num">Value</th><th className="num">NOI</th><th className="num">Mortgage to repay</th></tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.bbl} style={{ cursor: "pointer" }}
                    onClick={() => setPool(pool.includes(c.bbl) ? pool.filter((b) => b !== c.bbl) : [...pool, c.bbl])}>
                    <td><input type="checkbox" readOnly checked={pool.includes(c.bbl)} /></td>
                    <td>{c.rec.address}</td>
                    <td>{CLASS_LABEL[c.rec.class] ?? c.rec.class}</td>
                    <td className="num">{usd(c.value)}</td>
                    <td className="num">{usd(Math.round(holdingNOIYr(c.rec, game.econ, c.h, game.month)))}</td>
                    <td className="num dim">{c.loan > 0 ? usd(c.loan) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {qt && (
            <>
              <div className="btn-row">
                {quotes.map((x) => (
                  <button key={x.productId}
                    className={"btn" + (qt.productId === x.productId ? " btn-on" : "")}
                    disabled={!x.available}
                    style={!x.available ? { opacity: 0.42, cursor: "not-allowed" } : undefined}
                    title={x.why ?? `${x.lender} · ${(x.advance * 100).toFixed(0)}% advance`}
                    onClick={() => setProd(x.productId)}>
                    {x.lender} · {x.available ? `${x.ratePct.toFixed(2)}%` : "won't quote"}
                  </button>
                ))}
              </div>
              <div className="grid">
                <Row k="The pool" v={`${pool.length} buildings · ${usd(Math.round(qt.quality.value))} · ${qt.quality.why}`} />
                <Row k="Diversification" v={`${(qt.quality.score * 100).toFixed(0)} of 100 — worth ${((qt.advance - PRODUCTS.find((p) => p.id === qt.productId)!.ltv) * 100).toFixed(1)} points of advance and ${(qt.spreadCut * 100).toFixed(0)}bp of coupon`} />
                <Row k="Borrowing base" v={`${usd(qt.base)} · ${(qt.advance * 100).toFixed(0)}% advance · capped by ${qt.binding}`} strong />
                <Row k="Mortgages repaid" v={qt.payoff > 0 ? `${usd(qt.payoff)}${qt.penalties > 0 ? ` + ${usd(qt.penalties)} to break them` : ""}` : "none — the pool is unencumbered"} bad={qt.penalties > 0} />
                <Row k="Fees" v={usd(qt.fees)} />
                <Row k="Covenants" v={`${qt.minDSCR.toFixed(2)}x coverage, ${(qt.advance * 100).toFixed(0)}% leverage — tested on the POOL`} />
                <Row k="Structure" v={`${qt.ioM ? `${Math.round(qt.ioM / 12)}-yr IO, ` : ""}${qt.amortYears}-yr amort, ${Math.round(qt.termM / 12)}-yr term, recourse`} />
              </div>
              <Slider
                label="Draw"
                value={lev}
                min={0.2}
                max={1}
                step={0.02}
                onChange={setLev}
                format={() => `${usd(Math.floor(qt.base * lev))} · ${((qt.base * lev) / Math.max(1, qt.quality.value) * 100).toFixed(0)}% of the pool`}
                marks={[{ at: 0.5, label: "half" }, { at: 1, label: "the base" }]}
                hint={`Net to you ${usd(Math.floor(qt.base * lev) - qt.payoff - qt.penalties - Math.round(Math.floor(qt.base * lev) * (0.01 + qt.points)))} after the payoffs and fees. `
                  + "Drawing less than the base is the room you will have when the market turns — the covenant is tested against what you drew."}
              />
              <div className="btn-row">
                <button className="btn btn-buy" disabled={!qt.available || pool.length < FACILITY_MIN_ASSETS}
                  onClick={() => { useStore.getState().openFacility(pool, qt.productId, lev); setBuilding(false); }}>
                  Sign it · {usd(Math.floor(qt.base * lev))}
                </button>
                <button className="btn" onClick={() => setBuilding(false)}>Cancel</button>
              </div>
            </>
          )}
          {!qt && <div className="hint">Pick at least {FACILITY_MIN_ASSETS} buildings.</div>}
        </>
      )}

      {/* ---- every loan, one row each ---------------------------------- */}
      <div className="page-section">Loan by loan</div>
      <div className="scroll-x">
        <table className="tbl">
          <thead>
            <tr>
              <th>Building</th><th>Desk</th><th className="num">Balance</th><th className="num">Rate</th>
              <th className="num">LTV</th><th className="num">DSCR</th><th className="num">Payment</th>
              <th>Matures</th><th>Terms</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.filter((r) => r.h.loan).sort((a, b) => (b.h.loan!.balance) - (a.h.loan!.balance)).map(({ h, rec, v, noi }) => {
              const l = h.loan!;
              const p = productById(l.product);
              const ds = l.monthlyPmt * 12;
              const d = ds > 0 ? noi / ds : null;
              const lv = v > 0 ? l.balance / v : null;
              const near = l.maturityM - game.month <= 24;
              return (
                <Fragment key={h.bbl}>
                <tr>
                  <td>
                    <a className="lnk" onClick={() => useStore.getState().focus(h.bbl, true)}>{rec!.address}</a>
                    {pledged(game, h.bbl) ? <span className="dim"> · pledged</span> : null}
                  </td>
                  <td className="dim">{p.lender}</td>
                  <td className="num">{usd(l.balance)}</td>
                  <td className="num">{l.ratePct.toFixed(2)}%{(l.floating ?? l.product === "float") ? " fl" : ""}</td>
                  <td className={"num" + (lv !== null && lv > l.maxLTV ? " neg" : "")}>{lv !== null ? (lv * 100).toFixed(0) + "%" : "—"}</td>
                  <td className={"num" + (d !== null && d < l.minDSCR ? " neg" : "")}>{d !== null ? d.toFixed(2) : "—"}</td>
                  <td className="num">{usd(l.monthlyPmt)}</td>
                  <td className={near ? "neg" : ""}>{monthLabel(l.maturityM)}</td>
                  <td className="dim">
                    {[l.sweep ? "SWEPT" : null, game.month < l.ioUntilM ? "IO" : null, p.recourse ? "recourse" : null,
                      l.prepay === "yieldmaint" ? "YM" : null].filter(Boolean).join(" · ")}
                  </td>
                  <td>
                    <button
                      className={"btn btn-sm" + (refiRow === h.bbl ? " btn-on" : "")}
                      title={near
                        ? "This one matures inside two years. Refinance it while somebody is still lending."
                        : "What the desks would write against this building today."}
                      onClick={() => setRefiRow(refiRow === h.bbl ? null : h.bbl)}
                    >
                      Refi
                    </button>
                  </td>
                </tr>
                {refiRow === h.bbl && (
                  <tr>
                    <td colSpan={10} style={{ background: "rgba(43,37,26,0.035)" }}>
                      <RefiSection bbl={h.bbl} />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
            {fac && (
              <tr>
                <td><strong>The facility</strong> <span className="dim">· {fac.bbls.length} deeds crossed</span></td>
                <td className="dim">{fac.lender}</td>
                <td className="num">{usd(fac.balance)}</td>
                <td className="num">{fac.ratePct.toFixed(2)}%</td>
                <td className={"num" + (facM.ltv !== null && facM.ltv > fac.maxLTV ? " neg" : "")}>{facM.ltv !== null ? (facM.ltv * 100).toFixed(0) + "%" : "—"}</td>
                <td className={"num" + (facM.dscr !== null && facM.dscr < fac.minDSCR ? " neg" : "")}>{facM.dscr !== null ? facM.dscr.toFixed(2) : "—"}</td>
                <td className="num">{usd(fac.monthlyPmt)}</td>
                <td className={fac.maturityM - game.month <= 24 ? "neg" : ""}>{monthLabel(fac.maturityM)}</td>
                <td className="dim">{[fac.sweep ? "SWEPT" : null, game.month < fac.ioUntilM ? "IO" : null, "recourse", "crossed"].filter(Boolean).join(" · ")}</td>
                <td className="dim">—</td>
              </tr>
            )}
            {!rows.some((r) => r.h.loan) && !fac && (
              <tr><td colSpan={10} className="dim">No debt. Every building here is owned outright.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

