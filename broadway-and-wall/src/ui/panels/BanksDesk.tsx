import { useState, Fragment } from "react";
import { districtLabelOf } from "@/engine/mix";
import { useStore } from "@/state/store";
import { monthLabel } from "@/engine/types";
import { resolveRec } from "@/engine/value";
import { lenderHealth, capitalRatio, lenderBlurb, targetCapital, cashSplit, depositApy, insuredLimit, stayingPower } from "@/engine/lenders";
import { bankRatePct, liveSpread, lossClassOf } from "@/engine/pricing";
import { shortIndexOf } from "@/engine/market";
import { relCurve, lenderRelOf } from "@/engine/debt";
import { sweepApy } from "@/engine/types";
import { PRODUCTS, advanceFactor, statedLtv, underwritingStandards, standardsWord } from "@/engine/debt";
import { LineChart } from "@/ui/Chart";
import { usd } from "@/ui/format";
import { bankStatement, CapSpark } from "@/ui/panels/NotesPage";
import { lineLender } from "@/engine/credit";
import { BankLink } from "@/ui/panels/BankProfile";
import { appetiteAdvance } from "@/engine/pricing";

export function TheBanks() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const focus = useStore((s) => s.focus);
  const lenders = game.lenders ?? [];
  const [open, setOpen] = useState<string | null>(null);
  if (!lenders.length) return null;
  const yoursTotal = lenders.reduce((a, l) => a + l.yours, 0);
  // THE SHEET TODAY, desk by desk: the mid-cycle rate moved by standards and
  // your file, then the window's and the desk's own cut. This is the number
  // the owner said never moved. It moves here, and it says why.
  const standards = underwritingStandards(game);
  const sheetOf = (name: string) => {
    const p = PRODUCTS.find((x) => x.lender === name && !x.mezz && x.uwDscr > 0);
    if (!p) return null;
    const sheet = statedLtv(game, p);
    return { p, sheet, today: sheet.ltv * advanceFactor(game, name) };
  };
  return (
    <>
      <YourCash />
      <LenderCards />
      <div className="page-section">Lenders</div>
      <div className="hint">
        <b><a className="lnk" onClick={() => useStore.getState().setPage("banks")}>Full lender financials →</a></b>
      </div>
      <div className="hint">
        <b>Underwriting standards: {standardsWord(standards)}</b> ({standards >= 0 ? "+" : ""}{standards.toFixed(2)}, −1 to +1)
        {" "}· LTV adj: peak +5-6 pts, trough −10-12 · multifamily +5, industrial +2, retail −2, worn −3, relationship up to +4
        {" "}· "Sheet today": office, clean file, before desk appetite
      </div>
      <div className="hint">
        Appetite below ~0.12: stops quoting · click a row for its loan book
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
              xAt={(i) => { const q = m - 1 - i; return q === 0 ? "now" : `${q} qtr${q === 1 ? "" : "s"} ago`; }}
            />
            <div className="hint">
              {withHist.map((l, i) => (
                <span key={l.id} style={{ marginRight: 14, whiteSpace: "nowrap" }}>
                  <span style={{ display: "inline-block", width: 12, height: 3, background: C[i % C.length], verticalAlign: "middle", marginRight: 5 }} />
                  {l.name}
                </span>
              ))}
              · capital ÷ target, quarterly · seized at 0.22×
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
            <th className="num">Appetite</th><th className="num">Sheet today</th><th className="num">Your debt</th><th>Standing</th>
          </tr>
        </thead>
        <tbody>
          {lenders.map((l) => {
            const h = lenderHealth(l, game.econ);
            const cr = capitalRatio(l);
            const conc = l.book > 0 ? l.yours / l.book : 0;
            return (
              <Fragment key={l.id}>
                <tr onClick={() => setOpen(open === l.id ? null : l.id)} style={{ cursor: "pointer" }}>
                  <td>{open === l.id ? "▾ " : "▸ "}<BankLink name={l.name} /></td>
                  <td className="dim">
                    {l.kind === "bank" ? (l.dep?.rate !== undefined ? `deposits ${usd(l.dep.total)} at ${l.dep.rate.toFixed(2)}%` : "deposits") : l.kind === "life" ? "insurance float"
                      : l.kind === "conduit" ? "securitization" : "committed capital"}
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
                      title="Interest − funding cost − charge-offs, YTD">
                    {l.failedM !== undefined ? "—" : usd(l.netIncomeYr)}
                  </td>
                  <td className={"num" + (l.delinquent > 0.045 ? " neg" : "")}>{(l.delinquent * 100).toFixed(2)}%</td>
                  <td className="num">{l.chargeOffsYr > 0 ? usd(l.chargeOffsYr) : "—"}</td>
                  <td className={"num" + (l.appetite < 0.5 ? " neg" : "")}>
                    {l.failedM !== undefined ? "—" : l.appetite.toFixed(2)}
                  </td>
                  {(() => {
                    const sh = sheetOf(l.name);
                    const shut = l.failedM !== undefined || l.appetite < 0.12;
                    return (
                      <td className={"num" + (shut ? " neg" : "")}
                        title={sh ? `${sh.sheet.why.join(", ")} · after appetite and credit window: ~${(sh.today * 100).toFixed(0)}% LTV (office) · DSCR or debt yield may bind` : undefined}>
                        {shut ? "not quoting" : sh ? `${(sh.sheet.ltv * 100).toFixed(0)}% → ${(sh.today * 100).toFixed(0)}%` : "—"}
                      </td>
                    );
                  })()}
                  <td className="num">{l.yours > 0 ? usd(l.yours) : "—"}</td>
                  <td className={h.bad ? "neg" : "dim"}>{h.word}</td>
                </tr>
                {open === l.id && (
                  <tr>
                    <td colSpan={11} className="dim" style={{ paddingBottom: 12 }}>
                      <div style={{ marginBottom: 6 }}>{lenderBlurb(l.name)}</div>
                      <div>
                        Net income this year {usd(l.netIncomeYr)} · losses since inception {usd(l.chargeOffsTotal)}
                        {l.yours > 0 && <> · your share of book {(conc * 100).toFixed(2)}%</>}
                        {conc > 0.06 && <span className="neg"> · concentrated</span>}
                      </div>
                      {/* WHAT THE BOOK IS MADE OF. The named loans are counted
                          (engine/loanbook.ts) — yours, the street's, the cranes —
                          and their delinquency is whether those borrowers are
                          actually paying. The rest is the town's anonymous
                          owners, whose losses are modelled as a population. */}
                      {l.namedBook !== undefined && (
                        <div style={{ marginTop: 6 }}>
                          Book: {usd(l.namedBook)} named ({usd(l.yours)} yours)
                          {" "}· {usd(Math.max(0, l.book - l.namedBook))} other
                          {(l.namedDefault ?? 0) > 0
                            ? <span className="neg"> · {usd(l.namedDefault ?? 0)} named in default</span>
                            : " · named loans current"}
                          {lineLender(game)?.id === l.id && (game.loc?.balance ?? 0) > 0 && <> · your line: {usd(game.loc.balance)} drawn</>}
                        </div>
                      )}
                      <div style={{ marginTop: 6 }}>
                        {l.failedM !== undefined
                          ? "Receivership · existing loans still due · no new lending"
                          : l.appetite < 0.12
                            ? "Not quoting"
                            : l.appetite < 0.6
                              ? `Rationing · advance ~${(100 * appetiteAdvance(l.appetite)).toFixed(0)}% of sheet · +${Math.round((game.econ.deskPx?.[l.name]?.pull ?? Math.max(0, 1 - l.appetite) * 0.8) * 100)}bps spread`
                              : "Lending at stated terms"}
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
                                Book yield <b className="mono">{l.bookYield.toFixed(2)}%</b> · funding{" "}
                                <b className="mono">{Math.max(0, l.fundCost).toFixed(2)}%</b> · NIM{" "}
                                <b className={"mono" + (nim < 1.5 ? " neg" : "")}>{nim.toFixed(2)}pt</b>{" "}
                                {nim < 1.5
                                  ? <span className="neg">· negative carry risk</span>
                                  : nim < 2.5
                                    ? "· compressed"
                                    : "· healthy"}
                                {(l.divYr ?? 0) > 0 && <span className="dim"> · dividends {usd(l.divYr!)} YTD</span>}
                              </div>
                            )}
                            {(l.capHist?.length ?? 0) > 1 && (
                              <div style={{ marginBottom: 6 }}>
                                <CapSpark hist={l.capHist} target={target} />
                                <span className="dim" style={{ marginLeft: 8 }}>
                                  capital ratio, quarterly · dashed: {(target * 100).toFixed(1)}% target
                                </span>
                              </div>
                            )}
                            {cityTotal > 0 && (
                              <div style={{ marginBottom: 6 }}>
                                <span className="dim">Local book: </span>
                                {shares.map(([k, v]) => `${k} ${(100 * v / cityTotal).toFixed(0)}%`).join(" · ")}
                                {districts.length > 1 && <span className="dim"> · by district {districts.map(([k, v]) => `${districtLabelOf(parcels, k)} ${(100 * v / cityTotal).toFixed(0)}%`).join(", ")}</span>}
                                {full.length > 0 && (
                                  <span className="neg"> · at {(classCap * 100).toFixed(0)}% limit on {full.map(([k]) => k).join(" and ")} · new loans cut</span>
                                )}
                              </div>
                            )}
                            {book.length > 0 && (
                              <>
                                <div style={{ margin: "8px 0 4px", letterSpacing: "0.04em", textTransform: "uppercase", fontSize: "0.82em" }}>
                                  Local loans · {book.length} · {usd(cityTotal)}
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
                                Plus {usd(l.book - cityTotal)} outside the city (reflected in delinquency only)
                              </div>
                            )}
                            {stranded.length > 0 && (
                              <div className="alarm" style={{ marginTop: 6 }}>
                                {stranded.length === 1 ? "1 maturity" : `${stranded.length} maturities`} of yours within 5 yrs · lender {h.word} · refi risk
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
          Your debt: {usd(yoursTotal)}
        </div>
      )}
    </>
  );
}

/**
 * WHERE YOUR CASH IS. Operating cash in insured accounts, everything else in
 * Treasury bills — a bank failure cannot touch either (see cashSplit in
 * lenders.ts). There is nothing to choose: the old bank picker, operating
 * balance and sweep switch are gone at the owner's request. What a failing
 * desk can still do to you is stop lending on the loans it wrote, and that is
 * what the capital chart below is for.
 */
function YourCash() {
  const game = useStore((s) => s.game)!;
  const cs = cashSplit(game);
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  return (
    <div className="deal" style={{ marginBottom: 12 }}>
      <div className="deal-head">Cash</div>
      <div className="grid">
        <Row2 k="Cash" v={`${usd(Math.max(0, game.cash))} · not exposed to bank failure`} />
        <Row2 k="Operating account" v={`${usd(cs.atBank)} · insured to ${usd(insuredLimit(game))} · ${pct(depositApy(game.econ, cs.bank))} at ${cs.bank?.name ?? "bank"}`} />
        <Row2 k="Treasury bills" v={`${usd(cs.inBills)} · ${pct(sweepApy(game.econ))}`} />
      </div>
      <div className="hint">A failed lender stops funding its loans and construction commitments.</div>
    </div>
  );
}
function Row2({ k, v, bad }: { k: string; v: React.ReactNode; bad?: boolean }) {
  return (<><div className="k">{k}</div><div className={"v mono v-long" + (bad ? " v-bad" : "")}>{v}</div></>);
}

/**
 * WHO TO GO WITH, AT A GLANCE (2026-10-13). The table below is the whole
 * statement; this is the four things a borrower actually chooses on, in
 * words: what it costs today, how far they will go, whether they will still
 * be there in a crunch, and how they treat you. Every word moves — price with
 * the credit window and the desk's appetite, reach with standards, staying
 * power with its capital and its bad loans, standing with your history.
 */
export function LenderCards() {
  const game = useStore((s) => s.game)!;
  const lenders = (game.lenders ?? []);
  if (!lenders.length) return null;
  const rows = lenders.map((l) => {
    const p = PRODUCTS.find((x) => x.lender === l.name && !x.mezz && x.uwDscr > 0)
      ?? PRODUCTS.find((x) => x.lender === l.name && !x.mezz);
    const sp = stayingPower(game, l);
    const open = sp.word !== "closed";
    const rate = p ? bankRatePct(p.floating ? shortIndexOf(game.econ) : game.econ.indexRate, liveSpread(game.econ.deskPx?.[l.name], p.spread, lossClassOf(p)), { rel: relCurve(game, l.name) }) : null;
    const reach = p ? statedLtv(game, p).ltv * advanceFactor(game, l.name) : null;
    return { l, p, sp, open, rate, reach };
  });
  const quoting = rows.filter((r) => r.open && r.rate !== null).map((r) => r.rate!).sort((a, b) => a - b);
  const priceWord = (r: number | null) => {
    if (r === null || quoting.length < 2) return "—";
    const rank = quoting.indexOf(r) / (quoting.length - 1);
    return rank <= 0.34 ? "cheap" : rank >= 0.67 ? "dear" : "market";
  };
  const standingWord = (rel: number) => rel >= 80 ? "strong" : rel >= 55 ? "good" : rel >= 30 ? "known" : "new";
  const kindWord: Record<string, string> = { bank: "Bank", life: "Insurer", conduit: "Bond conduit", fund: "Debt fund" };
  const spColor: Record<string, string> = { solid: "#4a7d5a", stretched: "#a8862e", "at risk": "#a8402e", closed: "#6b6b6b" };
  return (
    <>
      <div className="page-section">Lender comparison</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8, margin: "6px 0 12px" }}>
        {rows.map(({ l, p, sp, open, rate, reach }) => (
          <div key={l.id} style={{ border: "1px solid var(--line, #333)", borderRadius: 6, padding: "8px 10px", opacity: open ? 1 : 0.6 }}
            title={lenderBlurb(l.name)}>
            <div style={{ fontWeight: 600 }}>{l.name}</div>
            <div className="hint" style={{ margin: "2px 0 6px" }}>{kindWord[l.kind] ?? l.kind}{p ? ` · ${p.label.split(" · ").slice(1).join(" · ")}` : ""}</div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 10, rowGap: 2, fontSize: 12 }}>
              <span className="hint">Price</span>
              <span>{open && rate !== null ? `${priceWord(rate)} · ${rate.toFixed(2)}%` : "not quoting"}</span>
              <span className="hint">Max LTV</span>
              <span>{open && reach !== null ? `${Math.round(reach * 100)}%` : "—"}</span>
              <span className="hint">Stability</span>
              <span title={sp.why} style={{ color: spColor[sp.word], fontWeight: 600 }}>{sp.word}</span>
              <span className="hint">Relationship</span>
              <span>{standingWord(lenderRelOf(game, l.name))}{l.yours > 0 ? ` · owed ${usd(l.yours)}` : ""}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
