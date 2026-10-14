import { useStore } from "@/state/store";
import { monthLabel } from "@/engine/types";
import { resolveRec } from "@/engine/value";
import {
  lenderHealth, capitalRatio, lenderBlurb, stayingPower, lenderConstitution, lenderPressure,
} from "@/engine/lenders";
import type { Lender } from "@/engine/lenders";
import {
  PRODUCTS, statedLtv, advanceFactor, windowOpen, loanMin, holdMaxOf, singleNameCap, lenderRelOf, relCurve, relAdvance,
  underwritingStandards, standardsWord,
} from "@/engine/debt";
import { deskRatePct } from "@/engine/pricing";
import { shortIndexOf } from "@/engine/market";
import { cityLoanBook } from "@/engine/loanbook";
import { lineLender } from "@/engine/credit";
import { workoutMood, deskCondition } from "@/engine/workout";
import { LineChart } from "@/ui/Chart";
import { usd } from "@/ui/format";
import { bankStatement } from "@/ui/panels/NotesPage";
import { useDeskView, openViewOn } from "@/ui/deskView";

/**
 * EVERY LENDER, ON THE RECORD, AT ANY TIME.
 *
 * The desks' books used to live as an expandable row at the bottom of City →
 * Markets → "The banks", under two rate charts — reachable, and in practice
 * nowhere. This is a room of its own on the Capital desk: pick a lender and
 * its whole file is on the page — what it is, its balance sheet, its income
 * statement line by line, the quality of its book, what it will write today
 * and on what terms, the limits it lends under, what it holds against you and
 * how it treats you at the workout table, every named loan on its book, and
 * the history of its capital. Every number is the one the engine itself reads
 * when it decides; nothing on this page is a summary invented for display.
 */
export function openBank(name: string) {
  openViewOn("banks", name);
  useStore.getState().setPage("banks");
}

/** A lender's name that opens its file; plain text when the holder is not a desk (a firm's private paper). */
export function BankLink({ name, children }: { name: string; children?: React.ReactNode }) {
  const isDesk = useStore((s) => !!s.game?.lenders?.some((l) => l.name === name));
  if (!isDesk) return <>{children ?? name}</>;
  return (
    <a className="lnk" onClick={(e) => { e.stopPropagation(); openBank(name); }} title={`Open ${name}'s books`}>
      {children ?? name}
    </a>
  );
}

const pc = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const pts = (x: number) => `${x.toFixed(2)} pts`;
const KIND_WORD: Record<string, string> = {
  bank: "Commercial bank · funded by deposits",
  life: "Life insurer · lends its general account",
  conduit: "CMBS conduit · sells its loans into bond trusts",
  fund: "Debt fund · committed capital from investors",
};

function Row({ k, v, bad, good }: { k: string; v: React.ReactNode; bad?: boolean; good?: boolean }) {
  return (<><div className="k">{k}</div><div className={"v mono v-long" + (bad ? " v-bad" : good ? " v-good" : "")}>{v}</div></>);
}
function Section({ title, children, note }: { title: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="page-section-block" style={{ marginTop: 18 }}>
      <div className="page-section">{title}</div>
      {note && <div className="hint">{note}</div>}
      {children}
    </div>
  );
}

export function BanksPage() {
  const game = useStore((s) => s.game)!;
  const lenders = game.lenders ?? [];
  const names = lenders.map((l) => l.name);
  const [sel, setSel] = useDeskView<string>("banks", names[0] ?? "", names);
  if (!lenders.length) return <div className="hint">There are no lenders in this town yet.</div>;
  const l = lenders.find((x) => x.name === sel) ?? lenders[0];
  const yourLine = lineLender(game);
  return (
    <>
      <div className="hint">
        Every lender in town, with nothing hidden. Pick one: its file below is the same set of numbers the
        engine reads when that desk quotes you, renews you, extends you or fails. Click a lender's name anywhere
        in the game to come straight here.
      </div>
      <div className="mkt-cards">
        {lenders.map((x) => {
          const h = lenderHealth(x, game.econ);
          const sp = stayingPower(game, x);
          const mult = capitalRatio(x) / Math.max(0.01, lenderConstitution(x).target);
          return (
            <button key={x.id} className={"mkt-card" + (x.name === l.name ? " mkt-card-on" : "")} onClick={() => setSel(x.name)}>
              <div className="mkt-card-head">
                <span className="mkt-card-name">{x.name}</span>
                <span className="mono">{x.failedM !== undefined ? "—" : `${mult.toFixed(2)}×`}</span>
              </div>
              <div className={"mkt-card-state" + (h.bad ? " neg" : "")}>{sp.word}</div>
              <div className="mkt-card-sub mono">
                {usd(x.book)} book · {pc(x.delinquent)} late
                {x.yours > 0 ? ` · you owe ${usd(x.yours)}` : ""}
                {yourLine?.id === x.id && (game.loc?.balance ?? 0) > 0 ? " · your line" : ""}
              </div>
            </button>
          );
        })}
      </div>
      <BankFile l={l} />
    </>
  );
}

function BankFile({ l }: { l: Lender }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const focus = useStore((s) => s.focus);
  const e = game.econ;
  const c = lenderConstitution(l);
  const h = lenderHealth(l, e);
  const sp = stayingPower(game, l);
  const cr = capitalRatio(l);
  const failed = l.failedM !== undefined;
  const book = cityLoanBook(game, parcels).filter((x) => x.holder === l.name);
  const sum = (f: (x: typeof book[number]) => boolean) => book.filter(f).reduce((a, x) => a + x.balance, 0);
  const named = sum(() => true);
  const yours = sum((x) => x.borrower === "player");
  const streetTerm = sum((x) => x.borrower !== "player" && x.kind !== "construction" && x.kind !== "line");
  const streetLines = sum((x) => x.borrower !== "player" && x.kind === "line");
  const cranes = sum((x) => x.kind === "construction");
  const defaulted = sum((x) => x.status === "default");
  const watch = sum((x) => x.status === "watch");
  const anon = l.anonBook ?? Math.max(0, l.book - named);
  const nim = (l.bookYield ?? 0) - Math.max(0, (l.fundCost ?? 0) + (l.panicBps ?? 0));
  const yourLine = lineLender(game)?.id === l.id;
  const isBank = game.bankId === l.id;

  // --- what it will write today ----------------------------------------
  const products = PRODUCTS.filter((p) => p.lender === l.name);
  const st = underwritingStandards(game);
  const adv = advanceFactor(game, l.name);

  // --- concentration ---------------------------------------------------
  const nameLimit = l.book * singleNameCap(l.kind);
  const byBorrower = new Map<string, number>();
  for (const x of book) byBorrower.set(x.borrower, (byBorrower.get(x.borrower) ?? 0) + x.balance);
  const borrowerName = (id: string) => id === "player" ? "You" : (game.rivals ?? []).find((r) => r.id === id)?.name ?? id;
  const topBorrowers = [...byBorrower.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const classTot = Object.values(l.classBook ?? {}).reduce((a, b) => a + b, 0);

  // --- you and this desk ---------------------------------------------------
  const rel = lenderRelOf(game, l.name);
  const mood = workoutMood(game, l.name);
  const cond = deskCondition(l);
  const statement = bankStatement(game, parcels, l.name);
  const mine = book.filter((x) => x.borrower === "player");

  // --- the record --------------------------------------------------------
  const hist = l.capHist ?? [];
  const news = (game.news ?? []).filter((n) => n.text.includes(l.name)).slice(0, 15);
  const inc = l.incYr;
  const prev = l.incPrevYr;
  // The year's books close in the tick that lands on a multiple of twelve
  // (January); from then until the next tick "this year" holds nothing.
  const monthsIn = game.month % 12;
  const cur = (v: number, neg = false) => monthsIn === 0 ? "—" : `${neg && v > 0 ? "−" : ""}${usd(v)}`;
  const prv = (v: number | undefined, neg = false) => prev && v !== undefined ? `${neg && v > 0 ? "−" : ""}${usd(v)}` : "—";

  return (
    <div style={{ marginTop: 14 }}>
      {/* ---------------------------------------------------------- who */}
      <div className="deal">
        <div className="deal-head">{l.name}</div>
        <div className="hint" style={{ marginTop: 0 }}>{KIND_WORD[l.kind] ?? l.kind}. {lenderBlurb(l.name)}</div>
        <div className="grid">
          <Row k="Standing" v={`${h.word} — ${sp.why}`} bad={h.bad} />
          <Row k="Status" bad={failed}
            v={failed
              ? `Closed ${monthLabel(l.failedM!)}${l.reopenM !== undefined ? ` · lending again around ${monthLabel(l.failedM! + l.reopenM)}` : ""}`
              : l.appetite < 0.12 ? "Open, but not quoting anything — its capital will not carry a new loan"
                : "Open and quoting"} />
          {(l.receiverUntilM ?? -1) > game.month && (
            <Row k="Receiver" v={`Still selling the failed desk's bad paper until ${monthLabel(l.receiverUntilM!)}`} bad />
          )}
          <Row k="Your accounts" v={[
            isBank ? "your operating bank" : null,
            yourLine ? ((game.loc?.balance ?? 0) > 0 ? `writes your line — ${usd(game.loc!.balance)} drawn` : "writes your line (undrawn)") : null,
            l.yours > 0 ? `holds ${usd(l.yours)} of your debt` : null,
          ].filter(Boolean).join(" · ") || "no relationship on the books yet"} />
        </div>
      </div>

      {/* ---------------------------------------------------- balance sheet */}
      <Section title="Balance sheet" note={<>
        What it has lent and what stands behind it. The book is every named loan in town that this desk holds — yours,
        the street's, the cranes — plus its lending to the town's other owners, which nobody can see loan by loan.
      </>}>
        <div className="grid">
          <Row k="Total book" v={usd(l.book)} />
          <Row k="Named loans" v={`${usd(named)} — yours ${usd(yours)} · street mortgages ${usd(streetTerm)}${streetLines ? ` · street lines ${usd(streetLines)}` : ""}${cranes ? ` · construction ${usd(cranes)}` : ""}`} />
          <Row k="Lent to the town's other owners" v={`${usd(anon)} (${pc(l.book > 0 ? anon / l.book : 0, 0)} of the book)`} />
          <Row k="Capital" v={usd(l.capital)} bad={l.capital <= 0} />
          <Row k="Capital ratio" v={`${pc(cr, 2)} against a ${pc(c.target, 1)} target — ${(cr / Math.max(0.01, c.target)).toFixed(2)}× · `
            + `${l.kind === "conduit" ? "a conduit is never seized" : `the examiners close a desk near ${pc(c.target * 0.22, 1)}`}`}
            bad={cr < c.target * 0.7} good={cr > c.target * 1.15} />
          <Row k="Funding mix" v={`${pc(c.wholesale, 0)} wholesale (repriced the week rates move) · ${pc(1 - c.wholesale, 0)} core${l.kind === "bank" ? " deposits" : ""}`} />
          {l.dep && <Row k="Deposits" v={`${usd(l.dep.total)} · ${pc(l.dep.uninsuredShare, 0)} over the insurance limit`} />}
          {c.adc > 0 && <Row k="Construction & land" v={`${pc(c.adc, 0)} of the book by policy — the first loans to sour when land prices fall`} />}
          <Row k="Pressure to sell" v={`${(lenderPressure(l) * 100).toFixed(0)} / 100 — ${lenderPressure(l) > 0.4 ? "it will sell loans and buildings at whatever clears its balance sheet" : lenderPressure(l) > 0 ? "some — the note desk may hear from it" : "none; it can wait for the right price"}`} bad={lenderPressure(l) > 0.4} />
        </div>
      </Section>

      {/* -------------------------------------------------- income statement */}
      <Section title="Income statement" note={<>
        {monthsIn === 0 ? "The year has just closed; " : `This calendar year to date (${monthsIn} month${monthsIn === 1 ? "" : "s"}), and `}the last full year. A desk earning
        nothing is a desk about to stop quoting; one losing money is eating the capital that decides whether it survives.
      </>}>
        {inc ? (
          <table className="tbl">
            <thead><tr><th></th><th className="num">This year</th><th className="num">Last year</th></tr></thead>
            <tbody>
              <tr><td>Interest on the performing book</td><td className="num">{cur(inc.interest)}</td><td className="num">{prv(prev?.interest)}</td></tr>
              <tr><td>Cost of funds{(l.panicBps ?? 0) > 0 ? " (incl. panic surcharge)" : ""}</td><td className="num">{cur(inc.funding, true)}</td><td className="num">{prv(prev?.funding, true)}</td></tr>
              <tr><td>Credit losses on the town's other owners</td><td className="num">{cur(inc.losses, true)}</td><td className="num">{prv(prev?.losses, true)}</td></tr>
              <tr><td>Operating costs ({c.opexPct.toFixed(2)}% of book a year)</td><td className="num">{cur(inc.opex, true)}</td><td className="num">{prv(prev?.opex, true)}</td></tr>
              <tr><td>Tax ({pc(c.taxRate, 0)})</td><td className="num">{cur(inc.tax, true)}</td><td className="num">{prv(prev?.tax, true)}</td></tr>
              <tr><td><b>Net income</b></td><td className={"num" + (l.netIncomeYr < 0 ? " neg" : "")}><b>{cur(l.netIncomeYr)}</b></td><td className={"num" + ((prev?.netIncome ?? 0) < 0 ? " neg" : "")}><b>{prv(prev?.netIncome)}</b></td></tr>
              <tr><td>Named loans written off (straight to capital)</td><td className="num">{(inc.writeOffs ?? 0) > 0 ? cur(inc.writeOffs!, true) : "—"}</td><td className="num">{prev?.writeOffs ? prv(prev.writeOffs, true) : "—"}</td></tr>
              <tr><td>Dividends paid to its owners</td><td className="num">{(l.divYr ?? 0) > 0 ? cur(l.divYr!) : "—"}</td><td className="num">{prev?.dividends ? prv(prev.dividends) : "—"}</td></tr>
            </tbody>
          </table>
        ) : <div className="hint">The first month of books is still being written.</div>}
        <div className="grid" style={{ marginTop: 8 }}>
          <Row k="Book yield" v={l.bookYield !== undefined ? `${l.bookYield.toFixed(2)}% — written over years, reprices as loans roll` : "—"} />
          <Row k="Cost of funds" v={l.fundCost !== undefined ? `${Math.max(0, l.fundCost).toFixed(2)}%${(l.panicBps ?? 0) > 0 ? ` + ${(l.panicBps! * 100).toFixed(0)}bp panic surcharge while a desk is in receivership` : ""}` : "—"} />
          <Row k="Net interest margin" v={`${pts(nim)} against a normal ${pts(c.normalNim)} for its kind`} bad={nim < c.normalNim * 0.5} />
          <Row k="Return on assets" v={l.book <= 0 ? "—"
            : monthsIn > 0 ? `${pc((l.netIncomeYr * 12 / monthsIn) / l.book, 2)} this year, annualised`
            : prev ? `${pc(prev.netIncome / l.book, 2)} last year` : "—"} />
        </div>
      </Section>

      {/* ------------------------------------------------------ credit quality */}
      <Section title="Credit quality" note={<>
        Named loans are counted: they are paying or they are not. The rest of the book is the town's other owners,
        whose losses follow vacancy, unemployment and the credit cycle.
      </>}>
        <div className="grid">
          <Row k="Delinquent, whole book" v={pc(l.delinquent, 2)} bad={l.delinquent > 0.045} />
          <Row k="Named loans not paying" v={`${usd(defaulted)}${named > 0 ? ` — ${pc(defaulted / named, 1)} of named` : ""}`} bad={defaulted > 0} />
          <Row k="Named loans on watch" v={usd(watch)} />
          <Row k="Other owners, delinquent" v={l.anonDelinq !== undefined ? pc(l.anonDelinq, 2) : "—"} />
          <Row k="Charge-offs this year" v={usd(l.chargeOffsYr)} />
          <Row k="Losses since founding" v={usd(l.chargeOffsTotal)} />
        </div>
      </Section>

      {/* -------------------------------------------------------- terms today */}
      <Section title="What it will write today" note={<>
        Underwriting standards in town are <b>{standardsWord(st)}</b> ({st >= 0 ? "+" : ""}{st.toFixed(2)}). This desk's
        appetite is <b>{l.appetite.toFixed(2)}</b>, so it advances {pc(adv, 0)} of whatever its sheet reads. Coupons are
        for a clean office building, with your file at this desk.
      </>}>
        {products.length ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>Paper</th><th className="num">Sheet today</th><th className="num">After appetite</th><th className="num">Coupon</th>
                <th className="num">Coverage / debt yield</th><th className="num">Term · IO · amort</th><th className="num">Cheque</th><th>Covenants</th><th>Open?</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const sheet = statedLtv(game, p, "office", "standard").ltv;
                const bench = p.floating ? shortIndexOf(e) : e.indexRate;
                const rate = deskRatePct(bench, p.spread, { ci: e.creditIdx ?? 1, app: failed ? 0 : l.appetite, rel: relCurve(game, l.name) });
                const open = !failed && windowOpen(game, p);
                const min = loanMin(game, p);
                const max = holdMaxOf(game, p) ?? 0;
                return (
                  <tr key={p.id}>
                    <td>{p.label.split(" · ").slice(1).join(" · ") || p.label}{p.recourse && !p.label.includes("recourse") ? <span className="dim"> · recourse</span> : null}</td>
                    <td className="num">{pc(sheet, 0)}</td>
                    <td className="num">{pc(sheet * adv, 0)}</td>
                    <td className="num">{rate.toFixed(2)}%<span className="dim"> ({p.floating ? "short" : "loan"} index + {(rate - bench).toFixed(2)})</span></td>
                    <td className="num">{p.uwDscr > 0 ? `${p.uwDscr.toFixed(2)}× · ${pc(p.debtYield, 1)}` : "on the dirt"}</td>
                    <td className="num">{Math.round(p.termM / 12)}y · {Math.round(p.ioM / 12)}y · {p.amortYears}y</td>
                    <td className="num">{min && max ? `${usd(min)} – ${usd(max)}` : min ? `from ${usd(min)}` : max ? `up to ${usd(max)}` : "any size"}</td>
                    <td className="dim">{p.minDSCR > 0 ? `DSCR ${p.minDSCR.toFixed(2)} · ` : ""}LTV {pc(p.maxLTV, 0)}</td>
                    <td className={open ? "" : "neg"}>{open ? "quoting" : failed ? "closed" : "window shut"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <div className="hint">This desk writes construction paper only.</div>}
      </Section>

      {/* ------------------------------------------------------ limits */}
      <Section title="Limits and concentration" note={<>
        Two tests no coverage ratio can argue with: how much of the book one borrower may be, and how much of it one
        kind of building may be. A desk that is full sends the next loan down the street, whoever brings it.
      </>}>
        <div className="grid">
          <Row k="Single-name limit" v={`${pc(singleNameCap(l.kind), 0)} of the book — ${usd(nameLimit)}`} />
          <Row k="Your room under it" v={`${usd(Math.max(0, nameLimit - l.yours))} left (you use ${usd(l.yours)})`} bad={l.yours > nameLimit * 0.85} />
        </div>
        {classTot > 0 && (
          <div className="hint" style={{ marginTop: 6 }}>
            By class in this town: {Object.entries(l.classBook ?? {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pc(v / classTot, 0)}`).join(" · ")}
          </div>
        )}
        {topBorrowers.length > 0 && (
          <table className="tbl" style={{ marginTop: 6 }}>
            <thead><tr><th>Biggest named borrowers</th><th className="num">Owed</th><th className="num">Of the book</th><th className="num">Of its limit</th></tr></thead>
            <tbody>
              {topBorrowers.map(([id, amt]) => (
                <tr key={id} style={id === "player" ? { background: "rgba(120,100,70,0.10)" } : undefined}>
                  <td>{borrowerName(id)}</td>
                  <td className="num">{usd(amt)}</td>
                  <td className="num">{pc(l.book > 0 ? amt / l.book : 0, 1)}</td>
                  <td className={"num" + (amt > nameLimit ? " neg" : "")}>{pc(nameLimit > 0 ? amt / nameLimit : 0, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ---------------------------------------------------- you and them */}
      <Section title="You and this desk" note={<>
        Your file is earned by paying as agreed; a tripped covenant, a workout or a deed in lieu takes it back.
      </>}>
        <div className="grid">
          <Row k="Your file" v={`${rel.toFixed(0)} / 100`} good={rel >= 55} bad={rel < 15} />
          <Row k="Your file is worth" v={relCurve(game, l.name) > 0 ? `${(relCurve(game, l.name) * 100).toFixed(0)}bp off every quote` : (l.kind === "conduit" ? "nothing — a bond has never met you" : "nothing yet")} />
          {products[0] && <Row k="…and on the advance" v={relAdvance(game, products[0]) > 0 ? `${(relAdvance(game, products[0]) * 100).toFixed(1)} points more` : "nothing yet"} />}
          <Row k="If you defaulted today" v={`${mood.willExtend ? "they would extend" : "they would not extend"} — ${mood.why}`} bad={!mood.willExtend} />
          {mood.willExtend && <Row k="Extension terms" v={`${pc(mood.feePct, 0)} fee · +${mood.bumpPct.toFixed(1)} on the coupon · ${pc(mood.paydownPct, 0)} paid down · cash flow swept`} />}
          <Row k="Their condition" v={cond.healthy ? "healthy" : cond.stretched ? "stretched" : "impaired"} bad={!cond.stretched} />
        </div>
        {mine.length > 0 && (
          <table className="tbl" style={{ marginTop: 6 }}>
            <thead><tr><th>Your paper with them</th><th>Kind</th><th className="num">Balance</th><th>Status</th></tr></thead>
            <tbody>
              {mine.map((x, i) => (
                <tr key={i} onClick={() => x.bbl && focus(x.bbl, true)} style={{ cursor: x.bbl ? "pointer" : undefined }}>
                  <td>{x.bbl ? resolveRec(parcels, game, x.bbl)?.address ?? x.bbl : x.kind === "line" ? "Line of credit" : "Portfolio facility"}</td>
                  <td>{x.kind}</td>
                  <td className="num">{usd(x.balance)}</td>
                  <td className={x.status === "default" ? "neg" : x.status === "watch" ? "" : "dim"}>{x.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ---------------------------------------------------- the loan book */}
      <Section title={`The loan book — ${statement.length} loan${statement.length === 1 ? "" : "s"} against deeds in this town`} note={<>
        Every mortgage and construction loan this desk holds against a named building. Click a row to open the building.
      </>}>
        {statement.length ? (
          <table className="tbl">
            <thead>
              <tr><th>Property</th><th>Borrower</th><th className="num">Balance</th><th className="num">Rate</th><th className="num">Maturity</th><th className="num">LTV then → now</th><th>Standing</th></tr>
            </thead>
            <tbody>
              {[...statement].sort((a, b) => b.balance - a.balance).map((r) => (
                <tr key={r.bbl + r.borrower} onClick={() => focus(r.bbl, true)}
                  style={{ cursor: "pointer", ...(r.yours ? { background: "rgba(120,100,70,0.10)" } : {}) }}>
                  <td>{resolveRec(parcels, game, r.bbl)?.address ?? r.bbl}{r.dev && <span className="dim"> · under construction</span>}</td>
                  <td className={r.yours ? "" : "dim"}>{r.borrower}</td>
                  <td className="num">{usd(r.balance)}</td>
                  <td className="num">{r.rate > 0 ? `${r.rate.toFixed(2)}%` : "—"}</td>
                  <td className="num">{monthLabel(r.matM)}</td>
                  <td className="num">
                    {r.origLtv !== null ? pc(r.origLtv, 0) : "—"} → {r.curLtv !== null ? <span className={r.curLtv > 1 ? "neg" : undefined}>{pc(r.curLtv, 0)}</span> : "—"}
                  </td>
                  <td className={r.bad ? "neg" : "dim"}>{r.dev ? "takeout at delivery" : r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="hint">No named loans on this desk.</div>}
      </Section>

      {/* ---------------------------------------------------- the record */}
      <Section title="The record">
        {hist.length > 1 ? (
          <>
            <LineChart height={150}
              series={[{ label: "capital ratio", color: "#3d6f9e", pts: hist.map((v) => v * 100) }]}
              bands={[{ at: c.target * 100, label: "own target", color: "#8b8370" }, ...(l.kind === "conduit" ? [] : [{ at: c.target * 22, label: "seized" }])]}
              yFmt={(v) => `${v.toFixed(1)}%`}
              xLabels={[`${Math.round(hist.length / 4)} yrs ago`, "now"]}
              xAt={(i) => { const q = hist.length - 1 - i; return q === 0 ? "now" : `${q} qtr${q === 1 ? "" : "s"} ago`; }} />
            <div className="hint">Capital ratio, quarterly. A line walking down toward the seizure band is a desk to refinance away from while it still quotes.</div>
          </>
        ) : <div className="hint">No history yet — the statement is sampled quarterly.</div>}
        {news.length > 0 && (
          <ul className="news-list" style={{ marginTop: 6 }}>
            {news.map((n, i) => <li key={i} className={n.kind === "warn" ? "neg" : undefined}><span className="dim mono">{monthLabel(n.q)}</span> {n.text}</li>)}
          </ul>
        )}
      </Section>
    </div>
  );
}
