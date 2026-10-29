// Permanent debt desk for a single deed — refinance / mezz / payoff.
// Extracted from ParcelDesk; also embedded from Portfolio and Debt pages.
import { consentFor } from "@/engine/vehicles";
import { useState } from "react";
import Slider from "@/ui/Slider";
import { useStore } from "@/state/store";
import { useHeldGame } from "@/ui/heldGame";
import { monthLabel, type GameState, type Holding } from "@/engine/types";
import { resolveRec, isVacantLandLoanCollateral, physicalOcc } from "@/engine/value";
import { refiQuotes, prepayPenalty, mezzQuote, rateCapCost, deskAdvice, capPremiumOn } from "@/engine/debt";
import { usd, pct } from "@/ui/format";
import { annualPayment, Row, Verdict } from "@/ui/panels/shared";
import { WhyButton } from "@/ui/WhyChain";
import { loanWhy, loanLead } from "@/ui/whyLinks";

/** Both liens' prepayment penalties at today's rates — what `refinance` adds to the fee. */
function breakCost(game: GameState, h: Holding | undefined): number {
  if (!h) return 0;
  return (h.loan ? prepayPenalty(h.loan, game.month, game.econ) : 0)
    + (h.mezz && h.mezz.balance > 0 ? prepayPenalty(h.mezz, game.month, game.econ) : 0);
}

export function RefiSection({ bbl }: { bbl: string }) {
  const game = useHeldGame(bbl);
  const parcels = useStore((s) => s.parcels)!;
  const { refi, placeMezz, acceptPrivateBorrowQuote, declinePrivateBorrowQuote } = useStore.getState();
  const holding = game.holdings[bbl];
  const privateQuotes = (game.privateBorrowQuotes ?? []).filter((q) => q.bbl === bbl);
  const mq = mezzQuote(game, parcels, bbl);
  // A leased fee with a ground rent is income paper, not vacant dirt — open
  // on an income desk even when the resolved class is still "land".
  const refiRec = resolveRec(parcels, game, bbl);
  const vacantDirt = !!holding && !!refiRec && isVacantLandLoanCollateral(game, holding, refiRec);
  const [product, setProduct] = useState<string>(vacantDirt ? "land" : "savings");
  const [lev, setLev] = useState(1);
  const [showAllQuotes, setShowAllQuotes] = useState(false);
  const { quotes, value, payoff } = refiQuotes(game, parcels, bbl);
  const fundableQuotes = quotes.filter((x) => x.available && x.maxProceeds > 0);
  const deskQuotes = showAllQuotes ? quotes : fundableQuotes;
  const cur = game.holdings[bbl]?.loan;
  // Breaking the stack costs both liens' penalties — `refinance` charges both.
  const existing = breakCost(game, holding);
  if (!quotes.length && !privateQuotes.length) {
    return (
      <div className="refi">
        <div className="deal-head">Refinance</div>
        <div className="hint">
          No quotes · appraisal {usd(value)}{payoff > 0 ? ` · ${usd(payoff)} outstanding` : ""} · insufficient income or credit window shut
        </div>
      </div>
    );
  }
  if (!quotes.length) {
    return (
      <div className="refi">
        <div className="deal-head">Refinance</div>
        <div className="hint">Appraisal {usd(value)} · payoff {usd(payoff)} · no bank quotes, private only</div>
        {privateQuotes.map((pq) => {
          const pts = Math.round(pq.principal * pq.points);
          // payoff from refiQuotes is already senior + mezz balance
          const net = pq.principal - payoff - pts - existing;
          return (
            <div key={pq.id} className="hint" style={{ marginBottom: 8, borderLeft: "3px solid #8a5620", paddingLeft: 8 }}>
              <div>
                <strong>{pq.lenderName}</strong> · private bridge ·{" "}
                <b className="mono">{usd(pq.principal)}</b> at <b className="mono">{pq.ratePct.toFixed(2)}%</b>
              </div>
              <div className="dim" style={{ marginTop: 4 }}>{pq.why}</div>
              <div style={{ marginTop: 4 }}>
                Net after payoff and points:{" "}
                <b className={net >= 0 ? "mono" : "mono neg"}>{net >= 0 ? "+" : ""}{usd(net)}</b>
              </div>
              <div className="btn-row" style={{ marginTop: 6 }}>
                <button className="btn" onClick={() => acceptPrivateBorrowQuote(pq.id)}>
                  Take private · {usd(pq.principal)}
                </button>
                <button className="btn-mini" onClick={() => declinePrivateBorrowQuote(pq.id)}>Pass</button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }
  // WHICH DESK YOU ARE ACTUALLY LOOKING AT.
  //
  // `product` opened at "savings" whether or not the savings bank quoted this
  // building, and every highlight on the screen was drawn off `product` while
  // every number was drawn off `quotes[0]`. So on any building the regional
  // did not quote — which since their $2.5M minimum is a great many — nothing
  // was lit up, the table had no selected row, and the panel was reporting one
  // desk's terms with another desk's name nowhere. The selection is whatever
  // quote is being read, and everything on the card keys off that.
  // ...and the fallback is a desk that will actually write, not merely the
  // first one in the list. Falling through to quotes[0] could land the card on
  // a lender quoting nothing, which is the same "describing a desk you are not
  // using" fault one step further along.
  // The opening desk ("savings") is a default, not a choice — when it writes
  // $0 the desk opened on a lender who will not lend, with the one who would
  // a click away. A desk you can only pick if it writes is picked the same way.
  const q = fundableQuotes.find((x) => x.id === product)
    ?? fundableQuotes[0]
    ?? quotes.find((x) => x.id === product)
    ?? quotes[0];
  const picked = q.id;
  const proceeds = Math.round(q.maxProceeds * lev);
  const capPremium = q.floating ? capPremiumOn(proceeds) : 0;
  const fee = Math.round(Math.max(proceeds, payoff) * 0.01) + Math.round(proceeds * q.points) + existing + capPremium;
  const toYou = proceeds - payoff - fee;
  // real annuity, not "coupon times 1.28" — the old shortcut overstated a
  // 30-yr amort by a full point of proceeds at today's rates
  // The desk sizes on the amortising payment wherever the paper amortises
  // inside its term; the IO year is a holiday and is shown as one below.
  const amortises = q.amortYears > 0 && q.ioM < q.termM;
  const annualDsIo = (proceeds * q.ratePct) / 100;
  const annualDs = amortises ? annualPayment(proceeds, q.ratePct, q.amortYears) : annualDsIo;
  // A ROOM, NOT A COLUMN. The desk ran as one 540px strip down half the
  // property page — lenders, table, terms, dial, before/after — with the other
  // half of the screen blank beside it. It is a master/detail desk, so it
  // reads like one: the market and the chosen desk's terms on the left, the
  // dial, the verdict, the before/after and the button on the right.
  return (
    <div className="refi refi-split">
      <div className="deal-head">Refinance</div>
      <div className="refi-intro">
      {cur && (cur.floating ?? cur.product === "float") && !cur.cap && (
        <div className="hint" style={{ marginBottom: 8 }}>
          Floating rate · no cap
          <button type="button" className="btn-mini" style={{ marginLeft: 8 }}
            onClick={() => useStore.getState().rateCap(bbl)}>
            Buy 3-yr cap · {usd(rateCapCost(cur))}
          </button>
        </div>
      )}
      {quotes.length > fundableQuotes.length && (
        <div className="hint" style={{ marginBottom: 6 }}>
          {fundableQuotes.length} of {quotes.length} lenders quoting
          {!showAllQuotes && (
            <> <button type="button" className="btn-mini" onClick={() => setShowAllQuotes(true)}>Show all</button></>
          )}
          {showAllQuotes && (
            <> <button type="button" className="btn-mini" onClick={() => setShowAllQuotes(false)}>Fundable only</button></>
          )}
        </div>
      )}
      <div className="hint">Appraisal {usd(value)} · payoff {usd(payoff)}</div>
      {existing > 0 && (
        <div className="hint">
          {existing > 0
            ? `${game.holdings[bbl]?.loan?.prepay === "yieldmaint" ? "Yield maintenance" : "Prepayment penalty"}: ${usd(existing)}`
            : ""}
        </div>
      )}
      </div>
      <div className="refi-pick">
      {privateQuotes.map((pq) => {
        const pts = Math.round(pq.principal * pq.points);
        // payoff from refiQuotes is already senior + mezz balance
        const net = pq.principal - payoff - pts - existing;
        return (
          <div key={pq.id} className="hint" style={{ marginBottom: 8, borderLeft: "3px solid #8a5620", paddingLeft: 8 }}>
            <div>
              <strong>{pq.lenderName}</strong> · private bridge ·{" "}
              <b className="mono">{usd(pq.principal)}</b> at <b className="mono">{pq.ratePct.toFixed(2)}%</b>,{" "}
              {(pq.points * 100).toFixed(1)} pts, {pq.termM} mo · {(100 * pq.ltv).toFixed(0)}% LTV as-is
            </div>
            <div className="dim" style={{ marginTop: 4 }}>{pq.why}</div>
            <div style={{ marginTop: 4 }}>
              Net after payoff and points:{" "}
              <b className={net >= 0 ? "mono" : "mono neg"}>{net >= 0 ? "+" : ""}{usd(net)}</b>
              {" · "}lapses {monthLabel(pq.expiresM)}
            </div>
            <div className="btn-row" style={{ marginTop: 6 }}>
              <button className="btn" onClick={() => acceptPrivateBorrowQuote(pq.id)}>
                Take private · {usd(pq.principal)}
              </button>
              <button className="btn-mini" onClick={() => declinePrivateBorrowQuote(pq.id)}>Pass</button>
            </div>
          </div>
        );
      })}
      {mq.available && (
        <div className="hint" style={{ marginBottom: 8, borderLeft: "3px solid #7a6a45", paddingLeft: 8 }}>
          <div>
            <strong>Cordage mezz</strong> · subordinate ·{" "}
            <b className="mono">{usd(mq.principal)}</b> at <b className="mono">{mq.ratePct.toFixed(2)}%</b>,{" "}
            {(mq.points * 100).toFixed(1)} pts · combined LTV {(100 * mq.ltvCombined).toFixed(0)}%
          </div>
          <div className="dim" style={{ marginTop: 4 }}>Second lien · senior loan unchanged</div>
          <div className="btn-row" style={{ marginTop: 6 }}>
            <button className="btn" disabled={!!consentFor(game, holding, "debt")}
              title={consentFor(game, holding, "debt") ?? undefined}
              onClick={() => placeMezz(bbl)}>Place mezz · {usd(mq.principal)}</button>
          </div>
        </div>
      )}

      {/* EVERY DESK AT ONCE, AND WHAT STOPPED EACH ONE.
          The complaint that started this was a $700M building with $130M of
          debt where every refinance option asked for money instead of giving
          it. The capital was there the whole time — the reason was not. Four
          desks quoted small for FOUR DIFFERENT reasons (a hold size, a minimum
          check, a shut securitisation window, a sponsor mark), and all four
          presented identically as "pay money in", so the screen read as one
          wall instead of four different ones with four different ways round.
          Reading them one at a time by clicking each button is not a market;
          this is the market. Sorted by what actually reaches your account. */}
      <div className="page-section" style={{ marginTop: 8 }}>Lender quotes</div>
        <table className="tbl">
          <thead>
            <tr><th>Lender</th><th className="num">Rate</th><th className="num" title="Coupon + points + cap premium, over the term">All-in</th><th className="num">LTV</th><th className="num">Loan</th><th className="num">Net to you</th></tr>
          </thead>
          <tbody>
            {[...deskQuotes]
              .map((x) => {
                const px = Math.round(x.maxProceeds);
                const cap = x.floating ? capPremiumOn(px) : 0;
                const f = Math.round(Math.max(px, payoff) * 0.01) + Math.round(px * x.points) + existing + cap;
                return { x, px, net: px - payoff - f };
              })
              .sort((a, b) => b.net - a.net)
              .map(({ x, px, net }) => (
                <tr
                  key={x.id}
                  className={x.id === picked ? "" : "dim"}
                  style={{
                    cursor: x.available && x.maxProceeds > 0 ? "pointer" : "not-allowed",
                    opacity: x.available && x.maxProceeds > 0 ? undefined : 0.5,
                    // The selected desk was distinguished only by NOT being
                    // dimmed, which on a four-row table reads as nothing at
                    // all. This is the row whose terms the rest of the card is
                    // describing, and it says so.
                    background: x.id === picked ? "rgba(120,160,255,0.14)" : undefined,
                    fontWeight: x.id === picked ? 600 : undefined,
                  }}
                  onClick={() => x.available && x.maxProceeds > 0 && setProduct(x.id)}
                  // The table is the picker (a row of buttons above it said the
                  // same thing twice), so it takes the keyboard too.
                  tabIndex={x.available && x.maxProceeds > 0 ? 0 : -1}
                  aria-selected={x.id === picked}
                  onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && x.available && x.maxProceeds > 0) { e.preventDefault(); setProduct(x.id); } }}
                >
                  <td>
                    {x.id === picked ? "▸ " : ""}{x.label}
                    <div className="dim" style={{ fontSize: 11, fontWeight: 400 }}>
                      {x.why ?? (px > 0 ? x.binding + (x.bindingWhy ? ` · ${x.bindingWhy}` : "") : "no loan")}
                    </div>
                    {/* A desk whose `why` already names the rent-roll haircut
                        was dropping the other half of the story — the credit
                        window or its own appetite cutting the stated advance.
                        Both reasons, or the player fixes the wrong one. */}
                    {x.why && px > 0 && x.advanceWhy && (
                      <div className="dim" style={{ fontSize: 11, fontWeight: 400 }}>· {x.advanceWhy}</div>
                    )}
                  </td>
                  <td className="num">{x.available ? pct(x.ratePct) : "—"}</td>
                  <td className="num">{x.available && px > 0 ? pct(x.allInPct) : "—"}</td>
                  <td
                    className="num"
                    // The advance the desk SIZED AT today, not the one on the
                    // term sheet. A 65% column beside a 25%-of-value cheque is
                    // the screen contradicting itself.
                    title={px > 0 && Math.abs(x.advanceToday - x.advanceLtv) > 0.02
                      ? `Sheet today ${(x.advanceLtv * 100).toFixed(0)}% (${x.sheetWhy ?? "their sheet"}); sized at ${(x.advanceToday * 100).toFixed(0)}% of value`
                      : x.sheetWhy ? `Sheet today: ${x.sheetWhy}` : undefined}
                  >
                    {px > 0 ? `${(x.advanceToday * 100).toFixed(0)}%` : `${((x.advanceLtv ?? x.maxLTV) * 100).toFixed(0)}%`}
                  </td>
                  <td className="num">{px > 0 ? usd(px) : "—"}</td>
                  <td className="num" style={{ color: net > 0 ? undefined : "#a8402e" }}>
                    {px > 0 ? usd(net) : "—"}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {(() => {
          // THE DESK'S OWN ADVICE. The table sorts by what reaches your
          // account, which puts the desk that advances most — and costs most
          // — on top of every list. This line names the cheapest money that
          // clears the payoff, and says what taking the most money costs.
          const stabilised = !!refiRec && !!holding && physicalOcc(refiRec, holding) >= 0.85;
          const adv = deskAdvice(quotes, payoff, stabilised);
          return adv ? <div className="hint" style={{ marginTop: 6 }}>{adv}</div> : null;
        })()}
      <div className="grid" style={{ marginTop: 12 }}>
        <Row k="Lender" v={`${q.label} · ${pct(q.ratePct)}`} strong
          why={<WhyButton id={loanWhy(game, q.lender)} lead={loanLead(game, q.lender, q.ratePct)} />} />
        <Row k="Max loan" v={`${usd(q.maxProceeds)} · ${(q.ltvAtMax * 100).toFixed(0)}% LTV · ${((q.advanceLtv ?? q.maxLTV) * 100).toFixed(0)}% advance · ${(q.maxLTV * 100).toFixed(0)}% covenant`} />
        {/* THE THREE NUMBERS THE COVERAGE RATIO IS MADE OF, at the amount the
            dial is actually set to.
            This row printed `dscrAtMax` — the coverage at the LENDER'S maximum
            — and never moved, so a player halving the draw watched the ratio
            they were halving it to fix sit perfectly still. And the two inputs
            were nowhere on the screen at all: a borrower cannot check a
            coverage ratio they cannot see the numerator of. `noiUw` is the
            income the desk sized against, which inside a lease-up is
            stabilised-less-holdback rather than what the building earns today,
            and that distinction belongs in front of the person signing. */}
        <Row
          k="Underwritten NOI"
          v={q.noiUw > 0 ? `${usd(Math.round(q.noiUw))}/yr` : "—"}
        />
        <Row
          k="Debt service"
          v={proceeds > 0 ? `${usd(Math.round(annualDs))}/yr on ${usd(proceeds)}${amortises && q.ioM > 0 ? ` amortizing (${usd(Math.round(annualDsIo))} during ${Math.round(q.ioM / 12)}-yr IO)` : ""}` : "—"}
        />
        <Row
          k="DSCR / debt yield"
          v={proceeds > 0 && annualDs > 0 && q.noiUw > 0
            ? `DSCR ${(q.noiUw / annualDs).toFixed(2)}${amortises && q.ioM > 0 ? ` amortizing (${(q.noiUw / annualDsIo).toFixed(2)} IO)` : ""} · DY ${((q.noiUw / proceeds) * 100).toFixed(1)}%`
            : "—"}
          bad={proceeds > 0 && annualDs > 0 && q.noiUw > 0 && q.noiUw / annualDs < 1.20}
        />
        <Row k="Binding constraint" v={q.maxProceeds > 0 ? q.binding : "no loan"} bad={q.binding === "debt yield" && q.maxProceeds > 0} />
        {q.maxProceeds > 0 && q.bindingWhy && (
          // a sentence, not a value: across both columns, never as a cell in
          // the label column (which sizes to its widest cell, and squeezed
          // every figure on the desk into a one-word-wide strip)
          <div className="dim" style={{ fontSize: 11, margin: "-2px 0 6px", gridColumn: "1 / -1" }}>{q.bindingWhy}</div>
        )}
        <Row
          k="Structure"
          v={`${q.ioM ? `${Math.round(q.ioM / 12)}-yr IO, ` : ""}${q.amortYears}-yr amort, ${q.termM / 12}-yr term, `
            + (q.maxProceeds > 0 && Math.abs(q.advanceToday - q.advanceLtv) > 0.02
              ? `sized at ${(q.advanceToday * 100).toFixed(0)}% (sheet ${((q.advanceLtv ?? q.maxLTV) * 100).toFixed(0)}%${q.sheetWhy ? `: ${q.sheetWhy}` : ""})`
              : `${((q.advanceLtv ?? q.maxLTV) * 100).toFixed(0)}% advance${q.sheetWhy ? ` (${q.sheetWhy})` : ""}`)
            + ` / ${(q.maxLTV * 100).toFixed(0)}% covenant, ${q.floating ? "floating" : "fixed"}`}
        />
        <Row k="Origination" v={`${(q.points * 100).toFixed(1)} pts · ${usd(Math.round(proceeds * q.points))}`} />
        {capPremium > 0 && <Row k="Rate cap at close" v={usd(capPremium)} />}
        <Row
          k="Prepayment"
          v={q.prepay === "open" ? "open"
            : q.prepay === "stepdown" ? `step-down, ${q.prepayM / 12} yrs (${Math.min(5, Math.ceil(q.prepayM / 12))}%${Math.min(5, Math.ceil(q.prepayM / 12)) > 1 ? "→1%, −1/yr" : ""})`
            : `yield maintenance, ${q.prepayM / 12} yrs`}
          bad={q.prepay === "yieldmaint"}
        />
        <Row k="Recourse" v={q.recourse ? "full recourse" : "non-recourse"} bad={q.recourse} />
        {q.kicker !== undefined && <Row k="Lender participation" v={`${(q.kicker * 100).toFixed(0)}% on sale`} bad />}
      </div>
      </div>
      <div className="refi-terms">
      <Slider
        label="Loan amount"
        value={lev}
        min={0}
        max={1}
        step={0.02}
        onChange={setLev}
        format={() => `${usd(proceeds)} · ${((proceeds / Math.max(1, value)) * 100).toFixed(0)}% LTV`
          + (proceeds > 0 && annualDs > 0 && q.noiUw > 0 ? ` · DSCR ${(q.noiUw / annualDs).toFixed(2)}` : "")}
        marks={[{ at: 0.5, label: "half" }, { at: 0.8, label: "80%" }, { at: 1, label: "max" }]}
        hint={`Debt service ${usd(annualDs)}/yr · NOI ${usd(Math.round(q.noiUw))} · `
          + `${toYou >= 0 ? `cash out ${usd(toYou)} after ${usd(fee)} fees` : `pay in ${usd(-toYou)}`}`}
      />
      {/* THE ANSWER, AT THE AMOUNT ON THE DIAL. Coverage after the refinance
          is what a lender tests and what a borrower loses sleep over; the
          all-in cost is what the money costs. Both were rows in a grid of
          twelve. */}
      {(() => {
        if (proceeds <= 0) return null;
        const dscrAfter = annualDs > 0 && q.noiUw > 0 ? q.noiUw / annualDs : null;
        const cfAfter = q.noiUw - annualDs;
        const tone = cfAfter < 0 || (dscrAfter !== null && dscrAfter < q.minDSCR) ? "bad"
          : dscrAfter !== null && dscrAfter < q.minDSCR * 1.15 ? "warn" : "good";
        const room = dscrAfter !== null ? ` · covenant ${q.minDSCR.toFixed(2)}x` : "";
        return (
          <Verdict
            label={`${q.label} · ${usd(proceeds)} · ${((proceeds / Math.max(1, value)) * 100).toFixed(0)}% LTV`}
            value={dscrAfter !== null ? `${dscrAfter.toFixed(2)}x · ${pct(q.allInPct)} all-in` : `${pct(q.allInPct)} all-in`}
            tone={tone}
            note={(cfAfter < 0
              ? `Negative cash flow · ${usd(Math.abs(Math.round(cfAfter / 12)))}/mo shortfall`
              : dscrAfter !== null && dscrAfter < q.minDSCR
                ? `Covenant breach at funding${room}`
                : dscrAfter !== null && dscrAfter < q.minDSCR * 1.15
                  ? `Thin cushion${room}`
                  : `Adequate cushion${room}`)
              + ` · ${toYou >= 0 ? `${usd(toYou)} to you at closing` : `${usd(-toYou)} to pay in at closing`}`}
          />
        );
      })()}
      {/* THE WHOLE DEAL AT WHATEVER THE DIAL SAYS, SIDE BY SIDE WITH THE ONE
          YOU HAVE.
          A refinance is not a question about proceeds, it is a question about
          what the building looks like AFTERWARDS — and the panel answered the
          first one on a slider and the second one nowhere. Every number here
          recomputes as the dial moves, and each is paired with what it is
          today, because the only useful form of "your coverage would be 1.34x"
          is "your coverage would be 1.34x, against 1.71x now".
          The cash flow line is the one that decides it. A cash-out refinance
          that leaves the building running at a deficit is a loan you service
          out of your other buildings, and that is the single most common way a
          good portfolio is lost — so it is on the screen in dollars, before
          you sign, with the sign it will actually have. */}
      {(() => {
        const cur = game.holdings[bbl]?.loan;
        const curDs = cur
          ? (game.month < cur.ioUntilM
            ? (cur.balance * cur.ratePct) / 100
            : cur.monthlyPmt * 12)
          : 0;
        const noi = q.noiUw;
        const cfNow = noi - curDs;
        const cfAfter = noi - annualDs;
        const ltvNow = value > 0 && cur ? cur.balance / value : 0;
        const dscrNow = curDs > 0 ? noi / curDs : null;
        const dscrAfter = annualDs > 0 ? noi / annualDs : null;
        const dyAfter = proceeds > 0 ? noi / proceeds : null;
        const cell = (k: string, now: string, after: string, bad?: boolean) => (
          <tr>
            <td>{k}</td>
            <td className="num dim">{now}</td>
            <td className={"num" + (bad ? " neg" : "")}><strong>{after}</strong></td>
          </tr>
        );
        return (
          <div style={{ marginTop: 6 }}>
            <table className="tbl">
              <thead>
                <tr><th>At {usd(proceeds)}</th><th className="num">Today</th><th className="num">After</th></tr>
              </thead>
              <tbody>
                {cell("Debt", cur ? usd(cur.balance) : "none", usd(proceeds))}
                {cell("LTV", cur ? `${(ltvNow * 100).toFixed(0)}%` : "0%",
                  `${((proceeds / Math.max(1, value)) * 100).toFixed(0)}%`,
                  proceeds / Math.max(1, value) > 0.75)}
                {cell("DSCR", dscrNow !== null ? `${dscrNow.toFixed(2)}x` : "—",
                  dscrAfter !== null ? `${dscrAfter.toFixed(2)}x` : "—",
                  dscrAfter !== null && dscrAfter < 1.25)}
                {cell("Debt yield", cur && cur.balance > 0 ? `${((noi / cur.balance) * 100).toFixed(1)}%` : "—",
                  dyAfter !== null ? `${(dyAfter * 100).toFixed(1)}%` : "—",
                  dyAfter !== null && dyAfter < 0.08)}
                {cell("Debt service / yr", cur ? `−${usd(Math.round(curDs))}` : "—", `−${usd(Math.round(annualDs))}`)}
                {cell("Cash flow after debt service / yr", `${cfNow < 0 ? "−" : ""}${usd(Math.abs(Math.round(cfNow)))}`,
                  `${cfAfter < 0 ? "−" : ""}${usd(Math.abs(Math.round(cfAfter)))}`, cfAfter < 0)}
                {cell("...per month", `${cfNow < 0 ? "−" : ""}${usd(Math.abs(Math.round(cfNow / 12)))}`,
                  `${cfAfter < 0 ? "−" : ""}${usd(Math.abs(Math.round(cfAfter / 12)))}`, cfAfter < 0)}
              </tbody>
            </table>
          </div>
        );
      })()}
      <div className="hint">
        {(() => {
          const noi = q.noiUw;
          const cfAfter = noi - annualDs;
          const dscrAfter = annualDs > 0 ? noi / annualDs : null;
          if (proceeds <= 0) return "Nothing drawn.";
          if (cfAfter < 0) {
            return `Shortfall ${usd(Math.abs(Math.round(cfAfter / 12)))}/mo after debt service.`;
          }
          if (dscrAfter !== null && dscrAfter < q.minDSCR) {
            return `DSCR ${dscrAfter.toFixed(2)}x vs ${q.minDSCR.toFixed(2)}x covenant · breach at funding · cash sweep.`;
          }
          if (dscrAfter !== null && dscrAfter < q.minDSCR * 1.15) {
            return `DSCR ${dscrAfter.toFixed(2)}x vs ${q.minDSCR.toFixed(2)}x covenant · thin cushion.`;
          }
          return `DSCR ${dscrAfter?.toFixed(2)}x vs ${q.minDSCR.toFixed(2)}x covenant.`;
        })()}
      </div>
      <div className="btn-row">
        <button
          className="btn btn-buy"
          disabled={proceeds < 100_000 || !q.available}
          onClick={() => refi(bbl, picked, lev)}
        >
          {toYou >= 0 ? `Refinance · take ${usd(toYou)}` : `Refinance · pay in ${usd(-toYou)}`}
        </button>
      </div>
      </div>
    </div>
  );
}

/**
 * THE REFINANCE DESK, FROM THE MAP CARD: the answer and a door.
 *
 * The full desk is four lenders, a dial and a before/after sheet — a room's
 * worth of reading that used to render inside a card a third of the screen
 * wide. The card now says what the best desk would write today and opens the
 * room. "Best" is the desk's own advice line where it has one; failing that
 * the cheapest money that clears the payoff, and failing that the desk that
 * advances most.
 */
export function RefiGlance({ bbl }: { bbl: string }) {
  const game = useHeldGame(bbl);
  const parcels = useStore((s) => s.parcels)!;
  const holding = game.holdings[bbl];
  const { quotes, value, payoff } = refiQuotes(game, parcels, bbl);
  const privateN = (game.privateBorrowQuotes ?? []).filter((q) => q.bbl === bbl).length;
  const open = () => useStore.getState().openProperty(bbl, "money");
  const live = quotes.filter((x) => x.available && x.maxProceeds > 0);
  if (!live.length) {
    return (
      <div className="refi">
        <div className="deal-head">Refinance</div>
        <div className="hint">
          No bank quotes
          {privateN ? ` · ${privateN} private bridge${privateN === 1 ? "" : "s"}` : ""} · appraisal {usd(value)}
          {payoff > 0 ? ` · ${usd(payoff)} outstanding` : ""}
        </div>
        <div className="btn-row"><button className="btn btn-sm" onClick={open}>Refinance →</button></div>
      </div>
    );
  }
  const net = (x: (typeof live)[number]) => {
    const px = Math.round(x.maxProceeds);
    const cap = x.floating ? capPremiumOn(px) : 0;
    const f = Math.round(Math.max(px, payoff) * 0.01) + Math.round(px * x.points) + cap + breakCost(game, holding);
    return px - payoff - f;
  };
  const clears = live.filter((x) => net(x) >= 0).sort((a, b) => a.allInPct - b.allInPct);
  const best = clears[0] ?? [...live].sort((a, b) => b.maxProceeds - a.maxProceeds)[0];
  const toYou = net(best);
  const refiRec = resolveRec(parcels, game, bbl);
  const stabilised = !!refiRec && !!holding && physicalOcc(refiRec, holding) >= 0.85;
  const advice = deskAdvice(quotes, payoff, stabilised);
  const tone = best.dscrAtMax < best.minDSCR ? "bad" : best.dscrAtMax < best.minDSCR * 1.15 ? "warn" : "good";
  return (
    <div className="refi">
      <div className="deal-head">Refinance</div>
      <Verdict
        label={`Best quote · ${best.label}`}
        value={`${usd(Math.round(best.maxProceeds))} at ${pct(best.allInPct)}`}
        tone={tone}
        note={`DSCR ${best.dscrAtMax.toFixed(2)}x at max · ${(best.ltvAtMax * 100).toFixed(0)}% LTV · ${toYou >= 0 ? `${usd(toYou)} to you` : `${usd(-toYou)} to pay in`} after payoff and fees · ${live.length} of ${quotes.length} lenders quoting`}
      />
      {advice && <div className="hint">{advice}</div>}
      <div className="btn-row">
        <button className="btn btn-sm" onClick={open}>Refinance →</button>
      </div>
    </div>
  );
}
