// THE LETTER ON THE DESK — one counter UI, used by the interrupt modal and
// the Deals page. Two copies of the same sliders drifted the last time the
// engine grew a knob the player could not see on both surfaces; this file is
// the single desk.
import { useState } from "react";
import Slider from "@/ui/Slider";
import type { GameState, LOI } from "@/engine/types";
import { CREDIT_LABEL, monthLabel } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import { managedRentPsfYr, resolveRec } from "@/engine/value";
import { loiSigningCost, netEffectivePsf } from "@/engine/leasing";
import { usd, sf } from "@/ui/format";
import { Row } from "@/ui/panels/shared";

export function loiMarketPsf(
  game: GameState, parcels: ParcelTable, loi: LOI,
): number {
  const rec = resolveRec(parcels, game, loi.bbl);
  const h = game.holdings[loi.bbl];
  if (!rec || !h) return loi.rentPsf;
  return managedRentPsfYr(rec, game.econ, h, loi.use);
}

export function loiTiCap(loi: LOI, market: number): number {
  const years = Math.max(1, loi.termM / 12);
  // Always room to offer some fit-out — even on a letter that asked for none —
  // because buying face rent with capital is a real landlord move.
  const floor = Math.round(market * 0.35 * years);
  return Math.max(loi.tiPsf, Math.round(loi.tiPsf * 1.4), floor);
}

export function loiFreeCap(loi: LOI): number {
  const byTerm = Math.min(Math.round(loi.termM * 0.2), loi.kind === "renewal" ? 6 : 12);
  // Even a letter with zero free months can be answered with some — that is
  // how you buy a higher face rent without looking greedy on the rent dial.
  return Math.max(loi.freeM, byTerm, loi.kind === "renewal" ? 3 : 4);
}

/** Their opening letter's net effective — what is already on the table. */
export function openingNe(loi: LOI): number {
  const rent = loi.openRentPsf ?? loi.rentPsf;
  const ti = loi.openTiPsf ?? loi.tiPsf;
  const free = loi.openFreeM ?? loi.freeM;
  // Build a view of the opener so TI delta is zeroed (open vs open).
  const view = { ...loi, tiPsf: ti, openTiPsf: ti, freeM: free };
  return netEffectivePsf(view, rent, ti, free);
}

type Counter = { rentPsf: number; tiPsf: number; freeM: number; bestFinal?: boolean };

/**
 * Sliders + the live NE readout. Parent owns Accept / Pass / Decide later;
 * this owns the counter draft and Send / Best&final / Back.
 */
export function LoiCounterDraft({
  loi, market, feeRate, fundShort,
  onSend, onBack,
}: {
  loi: LOI;
  market: number;
  feeRate?: number;
  /** Whether signing draws the line — passed through to Send. */
  fundShort: boolean;
  onSend: (c: Counter) => void;
  onBack: () => void;
}) {
  const [cRent, setCRent] = useState(+(loi.rentPsf * 1.05).toFixed(2));
  const [cTi, setCTi] = useState(loi.tiPsf);
  const [cFree, setCFree] = useState(loi.freeM);
  const tiCap = loiTiCap(loi, market);
  const freeCap = loiFreeCap(loi);
  const theirNe = openingNe(loi);
  const yourNe = netEffectivePsf(loi, cRent, cTi, cFree);
  const vsMkt = (yourNe / market - 1) * 100;
  // Signing cost follows the TI on the dial — cutting fit-out has to show up
  // in the cash line before you send, or the player cannot learn the trade.
  const costNow = loiSigningCost({ ...loi, tiPsf: cTi, rentPsf: cRent, freeM: cFree }, feeRate);
  const pushy = vsMkt > 8;
  const soft = vsMkt < -2;

  return (
    <div className="loi-counter">
      <Slider
        label="Your rent"
        value={cRent}
        min={+(Math.min(loi.rentPsf, market) * 0.70).toFixed(2)}
        max={+(Math.max(loi.rentPsf * 1.3, market * 1.2)).toFixed(2)}
        step={0.25}
        onChange={setCRent}
        format={(v) => `$${v.toFixed(2)}/sf · ${((v / market - 1) * 100).toFixed(0)}% vs market`}
        marks={[
          { at: loi.rentPsf, label: "their offer" },
          { at: +market.toFixed(2), label: "market" },
        ]}
        hint={loi.kind === "renewal"
          ? "Moving is expensive — an incumbent bends further than a prospect."
          : "They read your number against the market, not against their own opener."}
      />
      <Slider
        label="TI allowance"
        value={cTi}
        min={0}
        max={tiCap}
        step={1}
        onChange={setCTi}
        format={(v) => `$${v}/sf · ${usd(v * loi.sf)}`}
        marks={[
          ...(loi.tiPsf > 0 ? [{ at: loi.tiPsf, label: "they asked" }] : [{ at: 0, label: "none" }]),
          ...(loi.tiPsf > 4 ? [{ at: Math.round(loi.tiPsf / 2), label: "half" }] : []),
        ]}
        hint="Cut fit-out to save cash at signing, or offer more of it to buy a higher face rent."
      />
      <Slider
        label="Free rent"
        value={cFree}
        min={0}
        max={freeCap}
        step={1}
        onChange={setCFree}
        format={(v) => v === 0 ? "none" : `${v} month${v === 1 ? "" : "s"}`}
        marks={[
          ...(loi.freeM > 0 ? [{ at: loi.freeM, label: "they asked" }] : []),
          { at: 0, label: "none" },
        ]}
        hint="Free months are rent by another name — cutting them raises net effective; adding them buys a harder face rent."
      />

      <div className="loi-ne" style={{ marginTop: 8 }}>
        <div className="loi-line mono">
          Their letter · NE ${theirNe.toFixed(2)}/sf
          {" "}({((theirNe / market - 1) * 100).toFixed(0)}% vs market)
        </div>
        <div className="loi-line mono" style={{
          color: pushy ? "#a8402e" : soft ? "#3a7d46" : undefined,
          fontWeight: 600,
        }}>
          Your counter · NE ${yourNe.toFixed(2)}/sf
          {" "}({vsMkt >= 0 ? "+" : ""}{vsMkt.toFixed(0)}% vs market)
          {pushy ? " — they walk fast past here" : soft ? " — soft; they should take this" : " — near the indifference band"}
        </div>
        <div className="loi-line mono dim">
          Cash to sign at these terms · {usd(costNow)}
          {cTi !== loi.tiPsf ? ` (was ${usd(loiSigningCost(loi, feeRate))} on their letter)` : ""}
        </div>
      </div>

      <div className="btn-row" style={{ marginTop: 8 }}>
        <button
          className="btn btn-buy"
          onClick={() => onSend({ rentPsf: cRent, tiPsf: cTi, freeM: cFree })}
        >
          Send · ${cRent.toFixed(2)}/sf{cTi > 0 ? ` · TI $${cTi}` : ""}{cFree > 0 ? ` · ${cFree}mo free` : ""}
        </button>
        <button
          className="btn"
          title="The number is firm. Some hagglers sign; everyone else walks — nobody counters back a best and final."
          onClick={() => onSend({ rentPsf: cRent, tiPsf: cTi, freeM: cFree, bestFinal: true })}
        >
          Best &amp; final
        </button>
        <button className="btn" onClick={onBack}>Back</button>
      </div>
      {fundShort && (
        <div className="hint dim">Signing still draws the shortfall on the line if cash is short.</div>
      )}
    </div>
  );
}

/** Summary grid for the letter — opening terms, or the final conversation. */
export function LoiTermsGrid({
  loi, game, market, feeRate,
}: {
  loi: LOI;
  game: GameState;
  market: number;
  feeRate?: number;
}) {
  const h = game.holdings[loi.bbl];
  const annual = loi.rentPsf * loi.sf;
  const cost = loiSigningCost(loi, feeRate);
  const prevRent = loi.kind === "renewal" && loi.tenantIdx !== undefined
    ? h?.tenants[loi.tenantIdx]?.rentPsf : undefined;
  const isFinal = loi.stage === "countered";
  const theirNe = openingNe(loi);
  const nowNe = netEffectivePsf(loi, loi.rentPsf, loi.tiPsf, loi.freeM);

  return (
    <div className="grid">
      {prevRent !== undefined && (
        <Row
          k="They pay today"
          v={`$${prevRent.toFixed(2)}/sf → offering $${(loi.openRentPsf ?? loi.rentPsf).toFixed(2)} (${(loi.openRentPsf ?? loi.rentPsf) >= prevRent ? "+" : ""}${((((loi.openRentPsf ?? loi.rentPsf) / prevRent) - 1) * 100).toFixed(1)}%)`}
          strong
          bad={(loi.openRentPsf ?? loi.rentPsf) < prevRent}
        />
      )}
      {isFinal && loi.askedRentPsf !== undefined && (
        <>
          <Row
            k="You asked"
            v={`$${loi.askedRentPsf.toFixed(2)}/sf`
              + (loi.askedTiPsf !== undefined ? ` · TI $${loi.askedTiPsf}` : "")
              + (loi.askedFreeM ? ` · ${loi.askedFreeM}mo free` : "")}
            strong
          />
          <Row
            k="Their final"
            v={`$${(loi.counterRentPsf ?? loi.rentPsf).toFixed(2)}/sf`
              + (loi.counterTiPsf !== undefined ? ` · TI $${loi.counterTiPsf}` : "")
              + ((loi.counterFreeM ?? 0) > 0 ? ` · ${loi.counterFreeM}mo free` : "")}
            strong
          />
        </>
      )}
      {!isFinal && <Row k="Rent" v={`$${loi.rentPsf.toFixed(2)}/sf`} strong />}
      <Row
        k="Recovery"
        v={(loi.recovery ?? (loi.net ? "nnn" : "gross")) === "nnn" ? "triple net — they pay opex and taxes"
          : (loi.recovery ?? "gross") === "base" ? "base-year stop — you keep today's expense level"
          : "full gross — every expense is yours"}
        bad={(loi.recovery ?? (loi.net ? "nnn" : "gross")) === "gross"}
      />
      <Row
        k="Net effective"
        v={`$${nowNe.toFixed(2)}/sf · ${((nowNe / market - 1) * 100).toFixed(0)}% vs market ~$${market.toFixed(2)}`}
        strong
        bad={nowNe < market * 0.9}
      />
      {!isFinal && Math.abs(theirNe - nowNe) > 0.01 && (
        <Row k="Opening NE" v={`$${theirNe.toFixed(2)}/sf`} />
      )}
      <Row k="vs. face market" v={`${((loi.rentPsf / market - 1) * 100).toFixed(1)}% on face rent`} bad={loi.rentPsf < market * 0.9} />
      <Row k="Term" v={`${(loi.termM / 12).toFixed(1)} yrs, to ${monthLabel(game.month + loi.termM)}`} />
      <Row k="Annual face rent" v={usd(annual)} />
      <Row k="TI allowance" v={loi.tiPsf > 0 ? `$${loi.tiPsf}/sf · ${usd(loi.tiPsf * loi.sf)}` : "none"} />
      <Row k="Free rent" v={loi.freeM > 0 ? `${loi.freeM} months` : "none"} />
      <Row k="Cash to sign" v={usd(cost)} bad={cost > game.cash} strong />
      {h?.broker && (
        <Row
          k="Your exclusive"
          v={`6% of ${usd(annual * (loi.termM / 12))} of base rent over the term — ${usd(Math.round(annual * (loi.termM / 12) * 0.06))}, inside the number above`}
        />
      )}
      <Row k="Answer by" v={monthLabel(loi.expiresM)} />
    </div>
  );
}

export function LoiHeaderSub({ loi, address }: { loi: LOI; address: string }) {
  return (
    <>
      {loi.sector} · credit {CREDIT_LABEL[loi.credit]} · wants {sf(loi.sf)} at {address}
    </>
  );
}
