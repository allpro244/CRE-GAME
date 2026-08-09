import { useState } from "react";
import Slider from "@/ui/Slider";
import { useStore } from "@/state/store";
import { monthLabel, CREDIT_LABEL } from "@/engine/types";
import type { BuiltClass } from "@/engine/types";
import { holdingNOIYr, resolveRec, asIfOwned } from "@/engine/value";
import { MAX_TALKS } from "@/engine/acquire";
import { APPROACH_LIFE_M } from "@/engine/sim";
import { loiSigningCost, exclusiveFeeRate, netEffectivePsf } from "@/engine/leasing";
import { usd, sf } from "@/ui/format";
import { PortfolioSaleDesk } from "@/ui/panels/PortfolioPage";
import { liveBrokerCalls } from "@/ui/panels/broker";
import { Row } from "@/ui/panels/shared";
import { LoiCounterDraft, loiMarketPsf, openingNe } from "@/ui/panels/LoiNegotiate";

export function LoiCard({ loi, go }: { loi: import("@/engine/types").LOI; go: (bbl: string) => void }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const { respondLoi } = useStore.getState();
  const rec = parcels[loi.bbl];
  const [countering, setCountering] = useState(false);
  const h = game.holdings[loi.bbl];
  const market = loiMarketPsf(game, parcels, loi);
  const fee = exclusiveFeeRate(h);
  const prevRent = loi.kind === "renewal" && loi.tenantIdx !== undefined ? h?.tenants[loi.tenantIdx]?.rentPsf : undefined;
  const final = loi.stage === "countered";
  const theirNe = openingNe(loi);
  const nowNe = netEffectivePsf(loi, loi.rentPsf, loi.tiPsf, loi.freeM);
  // WHO ELSE IS CHASING THIS SPACE. The entire point of a tour is that you can
  // only have one of them, so the card has to say so before you press Accept.
  const rivalsOnTour = loi.tourId === undefined ? 0
    : game.lois.filter((l) => l.tourId === loi.tourId && l.id !== loi.id).length;
  return (
    <div className="loi">
      <button className="loi-addr" onClick={() => go(loi.bbl)}>{rec?.address ?? loi.bbl}</button>
      <div className="loi-line">
        <b>{loi.name}</b> <span className="mono">{CREDIT_LABEL[loi.credit]}</span> · {loi.sector}
        {loi.kind === "renewal" && <span className="chip chip-renewal">RENEWAL</span>}
        {loi.referred && <span className="chip" title="Your agent or renewal desk sent this back — it missed the auto-sign mandate.">REFERRED</span>}
        {rivalsOnTour > 0 && <span className="chip" title="Competing for the same square feet — you can take only one, and countering one makes the others impatient.">{rivalsOnTour + 1} FOR THE SAME SPACE</span>}
        {final && <span className="chip">FINAL</span>}
      </div>
      <div className="loi-line mono">
        {(loi.sf / 1000).toFixed(1)}k sf · ${loi.rentPsf.toFixed(2)}/sf {loi.net ? "NNN" : "gross"} · {(loi.termM / 12).toFixed(0)} yrs
        {loi.tiPsf > 0 ? ` · TI $${loi.tiPsf}` : " · no TI"}
        {` · ${loi.freeM > 0 ? `${loi.freeM}mo free` : "no free rent"}`}
      </div>
      {prevRent !== undefined && (
        <div className="loi-line mono" style={{ color: (loi.openRentPsf ?? loi.rentPsf) >= prevRent ? "#3a7d46" : "#a8402e" }}>
          paying ${prevRent.toFixed(2)} today → offering ${(loi.openRentPsf ?? loi.rentPsf).toFixed(2)}
          {" "}({(loi.openRentPsf ?? loi.rentPsf) >= prevRent ? "+" : ""}{((((loi.openRentPsf ?? loi.rentPsf) / prevRent) - 1) * 100).toFixed(1)}%)
        </div>
      )}
      {/* THE CONVERSATION, on the card. When they come back at you the card
          used to silently overwrite the terms with the new ones, so there was
          no way to see what your counter had actually achieved. */}
      {final && loi.askedRentPsf !== undefined && (
        <div className="loi-line mono" style={{ color: "#7a5c1e" }}>
          you asked ${loi.askedRentPsf.toFixed(2)}
          {loi.askedTiPsf !== undefined ? ` · TI $${loi.askedTiPsf}` : ""}
          {loi.askedFreeM ? ` · ${loi.askedFreeM}mo free` : ""}
          {loi.openRentPsf !== undefined ? ` (opened $${loi.openRentPsf.toFixed(2)})` : ""}
          {" "}→ their final ${(loi.counterRentPsf ?? loi.rentPsf).toFixed(2)}/sf
          {loi.counterTiPsf !== undefined ? ` · TI $${loi.counterTiPsf}` : ""}
          {(loi.counterFreeM ?? 0) > 0 ? ` · ${loi.counterFreeM}mo free` : ""}
        </div>
      )}
      {/* NE on the card BEFORE you open Counter — otherwise Accept is a blind
          click against a face rent the tenant is not even judging. */}
      <div className="loi-line mono">
        NE ${nowNe.toFixed(2)}/sf
        {" "}({((nowNe / market - 1) * 100).toFixed(0)}% vs market ~${market.toFixed(2)})
        {!final && Math.abs(theirNe - nowNe) > 0.05 ? ` · opened NE $${theirNe.toFixed(2)}` : ""}
      </div>
      <div className="loi-line mono dim">
        signing costs {usd(loiSigningCost(loi, fee))}{h?.broker ? " incl. the 6% exclusive" : ""} · answer by {monthLabel(loi.expiresM)}
      </div>
      {countering && !final && !loi.countered && (
        <LoiCounterDraft
          loi={loi}
          market={market}
          feeRate={fee}
          fundShort={loiSigningCost(loi, fee) > game.cash}
          onSend={(c) => { respondLoi(loi.id, "counter", true, c); setCountering(false); }}
          onBack={() => setCountering(false)}
        />
      )}
      {!countering && (
        <div className="btn-row">
          <button className="btn btn-buy" onClick={() => respondLoi(loi.id, "accept", true)}>
            {final ? "Take their final" : "Accept"}
          </button>
          {!loi.countered && !final && (
            <button className="btn" onClick={() => setCountering(true)}>Counter…</button>
          )}
          <button className="btn" onClick={() => respondLoi(loi.id, "decline")}>Pass</button>
        </div>
      )}
    </div>
  );
}

/**
 * AN OFFER ON ONE OF YOURS, answerable in full from the deals screen.
 *
 * Accept and Decline were the only two moves here, which meant a bid you would
 * have taken five per cent higher had to be thrown away or chased down into
 * the building's own record. Every seller alive picks up the phone instead —
 * once. That third button is the whole of selling well.
 */
export function SaleOfferCard({ bbl, ask, go }: { bbl: string; ask: number; go: (bbl: string) => void }) {
  const game = useStore((s) => s.game)!;
  const { acceptOffer, declineOffer, counterSale } = useStore.getState();
  const [counter, setCounter] = useState(0);
  const [countering, setCountering] = useState(false);
  const h = game.holdings[bbl];
  const offer = h?.sale?.offer;
  const suggested = offer ? Math.round(offer.price * 1.06) : 0;
  return (
    <div className="loi">
      <button className="loi-addr" onClick={() => go(bbl)}>{useStore.getState().parcels?.[bbl]?.address ?? bbl}</button>
      <div className="loi-line mono">
        ask {usd(ask)}{h?.sale?.mode === "marketed" ? " · marketed campaign" : ""}
        {/* THE NUMBER EVERY BUYER CONVERTS YOUR ASK INTO before they answer the
            phone. It was on the property card and not here, which is the one
            screen you actually work your sales from. */}
        {(() => {
          const st = useStore.getState();
          const rec = st.parcels ? resolveRec(st.parcels, game, bbl) : null;
          if (!rec || !h || rec.class === "land" || !rec.bldgArea || ask <= 0) return null;
          // Re-assessed at the ask, because that is what a buyer's going-in cap
          // is struck on — see the offer card, which quotes the same way.
          const noi = holdingNOIYr(rec, game.econ,
            asIfOwned(game, bbl, ask, { roll: h.tenants, occ: h.occ, cond: h.condition }, rec), game.month);
          if (noi <= 0) return null;
          const cap = (noi / ask) * 100;
          const mkt = game.econ.capRate[(rec.class as BuiltClass)] ?? cap;
          return (
            <> · asking a <b>{cap.toFixed(2)}%</b> cap
              <span className={cap < mkt - 0.4 ? " neg" : ""}> (market {mkt.toFixed(2)}%)</span>
            </>
          );
        })()}
      </div>
      {offer ? (
        <>
          <div className="loi-line mono">
            {offer.retrade ? <b className="neg">retraded — </b> : null}
            <b>{usd(offer.price)}</b> offered{offer.from ? ` by ${offer.from}` : ""} · good until {monthLabel(offer.expiresM)}
            {" "}· {((offer.price / Math.max(1, ask) - 1) * 100).toFixed(1)}% against your ask
          </div>
          {!countering && (
            <div className="btn-row">
              <button className="btn btn-buy" onClick={() => acceptOffer(bbl)}>Accept {usd(offer.price)}</button>
              <button className="btn" onClick={() => declineOffer(bbl)}>Decline</button>
              {!offer.countered && (
                <button className="btn" onClick={() => { setCounter(suggested); setCountering(true); }}>Counter…</button>
              )}
            </div>
          )}
          {countering && !offer.countered && (
            <>
              <Slider
                label="Counter"
                value={counter || suggested}
                min={offer.price + 1000}
                max={Math.round(Math.max(ask, offer.price * 1.3))}
                step={Math.max(1000, Math.round(offer.price / 400))}
                onChange={setCounter}
                format={(v) => `${usd(v)} · +${(((v / offer.price) - 1) * 100).toFixed(1)}% on their bid`}
                marks={[
                  { at: Math.round(offer.price * 1.03), label: "+3%" },
                  { at: Math.round(offer.price * 1.08), label: "+8%" },
                  { at: ask, label: "ask" },
                ]}
                hint="Inside what the building is worth to them and they take it. A little over and they split it. Well over and they walk — and an unsolicited buyer takes the whole approach with them."
              />
              <div className="btn-row">
                <button className="btn btn-buy" onClick={() => { counterSale(bbl, counter || suggested); setCountering(false); }}>
                  Counter at {usd(counter || suggested)}
                </button>
                <button className="btn" onClick={() => setCountering(false)}>Back</button>
              </div>
            </>
          )}
          {offer.countered && <div className="loi-line dim">You have been back to them once. This number is the number.</div>}
        </>
      ) : (
        <div className="loi-line dim">
          {h?.sale?.callM !== undefined
            ? `Book is out — offers due ${monthLabel(h.sale.callM)}.`
            : "no offers yet"}
        </div>
      )}
    </div>
  );
}

export function DealsPage() {
  const parcels = useStore((s) => s.parcels)!;
  const game = useStore((s) => s.game)!;
  const focus = useStore((s) => s.focus);
  const setPage = useStore((s) => s.setPage);
  const q = game.month;
  const go = (bbl: string) => { focus(bbl); setPage("property"); };

  const expiring: { bbl: string; name: string; sf: number; endM: number }[] = [];
  const maturities: { bbl: string; matM: number; bal: number; sweep: boolean }[] = [];
  const sales: { bbl: string; ask: number; offer?: { price: number; expiresM: number } }[] = [];
  // YOUR OWN KNOCKS, and only yours. This list used to carry the inbound calls
  // too, which was right while their only other home was a pop-up. They have a
  // page now — Marketplace prints the whole offering memorandum and the lapse
  // clock for each one — and two lists of the same files is one list the player
  // has to choose between. The desk keeps what the desk is for: the doors you
  // knocked on yourself, where an owner has given you a number.
  const calls = Object.entries(game.approaches)
    .filter(([bbl, a]) => !a.refused && a.ask && !a.inbound && !game.holdings[bbl])
    .map(([bbl, a]) => ({ bbl, ask: a.ask!, lapseM: a.q + APPROACH_LIFE_M }))
    .sort((a, b) => a.lapseM - b.lapseM);
  const inbound = liveBrokerCalls(game);
  for (const h of Object.values(game.holdings)) {
    for (const t of h.tenants) if (t.endM - q <= 12 && t.endM > q) expiring.push({ bbl: h.bbl, name: t.name, sf: t.sf, endM: t.endM });
    if (h.loan && (h.loan.maturityM - q <= 24 || h.loan.sweep)) maturities.push({ bbl: h.bbl, matM: h.loan.maturityM, bal: h.loan.balance, sweep: h.loan.sweep });
    if (h.sale) sales.push({ bbl: h.bbl, ask: h.sale.ask, offer: h.sale.offer });
  }

  return (
    <div>
      {game.exchange && (
        <div className="hint exchange-clock">
          ⏱ 1031 clock: buy for ≥ {usd(game.exchange.minPrice * 0.8)} by {monthLabel(game.exchange.deadlineM)} or {usd(game.exchange.deferredTax)} of deferred tax comes due.
        </div>
      )}
      <div className="deals-grid">

      <section>
        {/* EVERYTHING ON THE TABLE, contracts first — because a contract has
            a clock on it and a conversation does not. This used to be able to
            show exactly one row, since the game could only hold one. */}
        {(() => {
          const live = Object.values(game.talks ?? {})
            .sort((a, b) => (b.agreed ? 1 : 0) - (a.agreed ? 1 : 0) || (a.closeByM ?? 1e9) - (b.closeByM ?? 1e9));
          const committed = live.reduce((a, t) => a + (t.agreed ? (t.agreedPrice ?? t.theirPrice) : 0), 0);
          return (
            <>
              <div className="page-section">On the table · {live.length} of {MAX_TALKS}</div>
              {live.length === 0 && (
                <div className="hint">Nothing on the table. Open a negotiation from any listing — you can run {MAX_TALKS} at once.</div>
              )}
              {live.map((t) => (
                <div key={t.bbl} className="hint" style={{ cursor: "pointer", marginBottom: 6 }} onClick={() => go(t.bbl)}>
                  <div>
                    <strong>{parcels[t.bbl]?.address ?? t.bbl}</strong>
                    {t.agreed ? (
                      <> — agreed at <b className="mono">{usd(t.agreedPrice ?? t.theirPrice)}</b> with {t.sellerName},{" "}
                        {usd(t.deposit ?? 0)} down. Fund it by <b>{monthLabel(t.closeByM ?? game.month)}</b> or the deposit is theirs.</>
                    ) : (
                      <> — {t.sellerName} is at <b className="mono">{usd(t.theirPrice)}</b>, you are at {usd(t.yourPrice)}.{" "}
                        {t.final ? "Their final word." : `Round ${t.round} of ${t.maxRounds}.`}</>
                    )}
                  </div>
                  <button className={"btn btn-sm" + (t.agreed ? " btn-buy" : "")}
                    style={{ marginTop: 5 }}
                    onClick={(e) => { e.stopPropagation(); go(t.bbl); }}>
                    {t.agreed ? "Fund this acquisition →" : "Open negotiation →"}
                  </button>
                </div>
              ))}
              {committed > 0 && (
                <div className={"hint" + (committed > game.cash * 4 ? " alarm" : "")}>
                  {usd(committed)} of price agreed and not yet funded, against {usd(game.cash)} of cash.
                  {committed > game.cash * 4 && " You have signed more than you can plausibly fund. One of these is going to cost you its deposit."}
                </div>
              )}
            </>
          );
        })()}
        {/* TENANTS ASKING. Mid-lease relief letters — deliberately cards on
            this desk and never pop-ups: with thirty tenants a modal per ask
            would be a fire alarm every quarter. Both buttons are the whole
            decision; the letter lapses in three months and a lapse is a no. */}
        {!!game.asks?.length && (
          <>
            <div className="page-section">Tenants asking · {game.asks.length}</div>
            <div className="mini-list">
              {game.asks.map((a) => {
                const rec = resolveRec(parcels, game, a.bbl);
                const monthsLeft = a.expiresM - game.month;
                const yrsIn = Math.floor((game.month - a.tenantStartM) / 12);
                return (
                  <div key={a.id} className="deal" style={{ marginBottom: 8 }}>
                    <div className="deal-head">
                      {a.name}{yrsIn >= 8 ? ` · ${yrsIn} years in the building` : ""} · {rec?.address ?? a.bbl}
                    </div>
                    <div className="grid">
                      <Row k="Their ask" v={`$${a.askPsf.toFixed(0)}/sf, down from $${a.currentPsf.toFixed(0)} · adds ${Math.round(a.addM / 12)} yrs of term`} strong />
                      <Row k="Rent forgone" v={`~${usd(Math.round((a.currentPsf - a.askPsf) * a.sf))} / yr on ${sf(a.sf)}`} />
                      <Row k="If you decline" v="the paper stands — and a tenant running lean fails at three times the rate" />
                      <Row k="On the desk" v={`${monthsLeft} month${monthsLeft === 1 ? "" : "s"} — a lapse is a no`} bad={monthsLeft <= 1} />
                    </div>
                    <div className="modal-actions">
                      <button className="btn btn-buy" onClick={() => useStore.getState().answerAsk(a.id, "grant")}>Grant relief</button>
                      <button className="btn" onClick={() => useStore.getState().answerAsk(a.id, "decline")}>Hold the paper</button>
                      <button className="btn" onClick={() => go(a.bbl)}>The building</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
        <div className="page-section">Letters of intent · {game.lois.length}</div>
        {game.lois.length === 0 && <div className="hint">No live negotiations. Vacant space in high-demand buildings draws tenants.</div>}
        <div className="loi-grid">
          {[...game.lois]
            .sort((a, b) => (b.referred ? 1 : 0) - (a.referred ? 1 : 0)
              || (a.tourId ?? -a.id) - (b.tourId ?? -b.id) || a.id - b.id)
            .map((loi) => <LoiCard key={loi.id} loi={loi} go={go} />)}
        </div>
        {/* HOW THEY ANSWERED. A counter used to resolve into a toast that was
            gone in three seconds and a card that vanished off the grid — so the
            most consequential leasing decision in the game left no account of
            itself. What you asked, what they did, and what it was worth. */}
        {!!game.leaseReplies?.length && (
          <>
            <div className="page-section" style={{ marginTop: 18 }}>Their answer · last {game.leaseReplies.length}</div>
            <div className="mini-list">
              {game.leaseReplies.map((r, i) => {
                const delta = (r.theirRentPsf - r.askedRentPsf) * r.sf;
                const freeBit = (asked?: number, got?: number) =>
                  asked || got
                    ? ` · free ${asked ?? 0}→${got ?? asked ?? 0}mo`
                    : "";
                return (
                  <button key={i} className="neighbor" onClick={() => go(r.bbl)}>
                    <span className="neighbor-addr">
                      {r.outcome === "took" ? "✓ " : r.outcome === "walked" ? "✕ " : "↩ "}
                      {r.name}
                      <span className="dim"> · {r.address}</span>
                    </span>
                    <span className="neighbor-meta mono">
                      {r.outcome === "took"
                        ? `took your $${r.askedRentPsf.toFixed(2)}/sf${r.askedFreeM ? ` / ${r.askedFreeM}mo free` : ""} — ${usd(r.askedRentPsf * r.sf)} a year on ${sf(r.sf)}`
                        : r.outcome === "walked"
                          ? `walked. You asked $${r.askedRentPsf.toFixed(2)} into a $${r.marketPsf.toFixed(2)} market — ${sf(r.sf)} still empty`
                          : `came back at $${r.theirRentPsf.toFixed(2)} against your $${r.askedRentPsf.toFixed(2)}${freeBit(r.askedFreeM, r.theirFreeM)} · ${delta >= 0 ? "+" : "−"}${usd(Math.abs(delta))} a year`}
                      {" · "}{monthLabel(r.m)}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </section>

      <section>
        {/* An off-market approach that you set aside has to be findable, or
            "Not now" is the same as "never" — and a number an owner gave you is
            a live deal whether or not you looked at it today. */}
        <div className="page-section">Doors you knocked on · {calls.length}</div>
        {calls.length === 0 && <div className="hint">Nothing open. Walk up to any building you do not own and ask.</div>}
        <div className="mini-list">
          {calls.map((c) => (
            <button key={c.bbl} className="neighbor" onClick={() => go(c.bbl)}>
              <span className="neighbor-addr">{parcels[c.bbl]?.address ?? c.bbl}</span>
              <span className="neighbor-meta">
                {usd(c.ask)} · lapses {monthLabel(c.lapseM)}
              </span>
            </button>
          ))}
        </div>
        {/* The other direction of the same channel, and it is somebody else's
            clock. One line, pointing at the page that holds the file — not a
            second copy of it. */}
        {inbound.length > 0 && (
          <div className="hint" style={{ cursor: "pointer" }} onClick={() => useStore.getState().setPage("market")}>
            <strong>{inbound.length}</strong> broker{inbound.length === 1 ? " is" : "s are"} shopping you something
            off-market — the soonest lapses <b>{monthLabel(inbound[0].lapseM)}</b>, in{" "}
            {Math.max(0, inbound[0].lapseM - game.month)} month
            {Math.max(0, inbound[0].lapseM - game.month) === 1 ? "" : "s"}. The files are on Marketplace.
          </div>
        )}

        {/* EVERYTHING YOU ARE SELLING, ON THE DESK YOU SELL FROM.
            A book of buildings in the market was visible only on the Portfolio
            page, behind the bundling tool that created it — so the one screen
            called "Deals" could show you four individual listings and be
            silent about the largest transaction you had open. A portfolio is a
            sale in progress; it goes with the sales in progress, and the whole
            desk comes with it so the bid can be answered from here. */}
        <div className="page-section" style={{ marginTop: 18 }}>
          Sales in progress · {sales.length + (game.portfolioSale ? 1 : 0)}
        </div>
        {sales.length === 0 && !game.portfolioSale
          && <div className="hint">Nothing listed. Sell from any owned building's card.</div>}
        {game.portfolioSale && <PortfolioSaleDesk bundle={game.portfolioSale.bbls} clear={() => { /* nothing to clear: not bundling here */ }} />}
        {sales.map((sl) => <SaleOfferCard key={sl.bbl} bbl={sl.bbl} ask={sl.ask} go={go} />)}

        <div className="page-section" style={{ marginTop: 18 }}>Rolling within a year · {expiring.length}</div>
        <div className="mini-list">
          {expiring.map((e, i) => (
            <button key={i} className="neighbor" onClick={() => go(e.bbl)}>
              <span className="neighbor-addr">{e.name}</span>
              <span className="neighbor-meta mono">{parcels[e.bbl]?.address} · exp {monthLabel(e.endM)}</span>
            </button>
          ))}
          {expiring.length === 0 && <div className="hint">No near-term expirations.</div>}
        </div>

        <div className="page-section" style={{ marginTop: 18 }}>Debt watch · {maturities.length}</div>
        <div className="mini-list">
          {maturities.map((m, i) => (
            <button key={i} className="neighbor" onClick={() => go(m.bbl)}>
              <span className="neighbor-addr">{m.sweep ? "⚠ " : ""}{parcels[m.bbl]?.address}</span>
              <span className="neighbor-meta mono">{usd(m.bal)} · balloon {monthLabel(m.matM)}{m.sweep ? " · SWEEP" : ""}</span>
            </button>
          ))}
          {maturities.length === 0 && <div className="hint">No balloons or breaches on the radar.</div>}
        </div>
      </section>
      </div>
    </div>
  );
}

// The credit window, in words rather than an index nobody can calibrate.
