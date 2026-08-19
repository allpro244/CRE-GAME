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
import {
  bumpOf, DEFAULT_BUMP_PCT, loiSigningCost, netEffectivePsf,
  termBandM, termPushBands,
} from "@/engine/leasing";
import { usd, sf } from "@/ui/format";
import { Row } from "@/ui/panels/shared";
import { Gloss } from "@/ui/Glossary";

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
  const bump = loi.openBumpPct ?? bumpOf(loi);
  // Build a view of the opener so TI delta is zeroed (open vs open).
  const view = { ...loi, tiPsf: ti, openTiPsf: ti, freeM: free, bumpPct: bump, openBumpPct: bump };
  return netEffectivePsf(view, rent, ti, free, bump);
}

/**
 * TERM AND SIZE FIRST. When a letter lands, those two facts decide whether
 * you even care about the rent — everything else is secondary ink.
 */
export function LoiHero({ loi }: { loi: LOI }) {
  const yrs = loi.termM / 12;
  const yrLabel = Number.isInteger(yrs) ? String(yrs) : yrs.toFixed(1);
  // Once the term itself has been negotiated, the number on the paper is not
  // what they walked in wanting — and which is which decides how the rest of
  // the card reads. Absent on any letter nobody has countered.
  const openTerm = loi.openTermM ?? loi.termM;
  const moved = Math.abs(openTerm - loi.termM) >= 1;
  return (
    <div className="loi-hero" aria-label={`${sf(loi.sf)}, ${yrLabel} years`}>
      <span className="loi-hero-sf">{sf(loi.sf)}</span>
      <span className="loi-hero-sep">·</span>
      <span className="loi-hero-term">{yrLabel}-year term</span>
      {moved && <span className="loi-hero-sep dim"> · they asked {(openTerm / 12).toFixed(1)}</span>}
    </div>
  );
}

type Counter = {
  rentPsf: number; tiPsf: number; freeM: number; bumpPct: number;
  /** Months. The term is negotiable like the rest of it. */
  termM: number;
  bestFinal?: boolean;
};

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
  const [cBump, setCBump] = useState(bumpOf(loi));
  const [cTerm, setCTerm] = useState(loi.termM);
  const openTerm = loi.openTermM ?? loi.termM;
  // EVERYTHING ON THIS CARD IS STRUCK OVER THE TERM ON THE DIAL, not the term
  // they walked in with. The allowance cap, the free-rent cap, net effective and
  // the cash to sign all read `termM` — `loiSigningCost` scales the commission
  // by termM/12, so pushing a three-year tenant to ten roughly triples the
  // cheque. Without this view the card would quote a deal the player cannot fund.
  const view: LOI = { ...loi, termM: cTerm };
  const tiCap = loiTiCap(view, market);
  const freeCap = loiFreeCap(view);
  // Both caps are functions of the term, so shortening the paper can put a dial
  // above its own ceiling. Read the clamped value everywhere — including what
  // Send hands over — rather than letting the card price a counter it would not
  // let you set.
  const cTiC = Math.min(cTi, tiCap);
  const cFreeC = Math.min(cFree, freeCap);
  const theirNe = openingNe(loi);
  const yourNe = netEffectivePsf(view, cRent, cTiC, cFreeC, cBump);
  const vsMkt = (yourNe / market - 1) * 100;
  // Signing cost follows the TI and the term on the dials — cutting fit-out or
  // stretching the paper has to show up in the cash line before you send, or
  // the player cannot learn the trade.
  const costNow = loiSigningCost({ ...view, tiPsf: cTiC, rentPsf: cRent, freeM: cFreeC }, feeRate);
  const pushy = vsMkt > 8;
  const soft = vsMkt < -2;
  const openBump = loi.openBumpPct ?? bumpOf(loi);
  // The tenant's own band — the same one the letter's term was drawn from, and
  // the same unit the engine scores the push in.
  const band = termBandM(loi.credit);
  const termMin = Math.max(12, Math.floor(Math.min(openTerm, band.loM) / 12) * 12 - 12);
  const termMax = Math.min(180, Math.max(Math.ceil(Math.max(openTerm, band.hiM) / 12) * 12 + 24, 120));
  const push = termPushBands(loi, cTerm);
  const draft: Counter = { rentPsf: cRent, tiPsf: cTiC, freeM: cFreeC, bumpPct: cBump, termM: cTerm };

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
      {/* THE TERM IS A DIAL, NOT INK. WALT, when the space rolls, and the size
          of the commission cheque are all this number — and it was the one term
          on the letter the landlord could not answer. The band is the tenant's
          own: past about one band-width they stop being able to sign at any
          rent, because the length of the lease is a fact about their business
          and not about the price of the space. */}
      <Slider
        label="Term"
        value={cTerm}
        min={termMin}
        max={termMax}
        step={12}
        onChange={setCTerm}
        format={(v) => `${(v / 12).toFixed(0)} years`
          + (Math.abs(v - openTerm) < 6
            ? " · what they asked for"
            : ` · ${push > 0 ? "+" : ""}${push.toFixed(1)}× their band`)}
        marks={[
          { at: openTerm, label: "they asked" },
          ...(band.hiM !== openTerm ? [{ at: band.hiM, label: "top of their band" }] : []),
        ]}
        hint={Math.abs(push) < 0.35
          ? `Credit ${CREDIT_LABEL[loi.credit]} covenants plan on ${(band.loM / 12).toFixed(0)}–${(band.hiM / 12).toFixed(0)} years. Commission is struck over the whole term, so a longer lease is a bigger cheque at signing.`
          : push > 0
            ? `${push.toFixed(1)} band-widths past their own plan. Longer paper is worth more to you and costs more to sign — the commission is ${(cTerm / 12).toFixed(0)} years of it.`
            : `Shorter than they asked. The allowance amortises over fewer years, so this reads as a harder deal to them too — and you get the space back sooner.`}
      />
      <Slider
        label="TI allowance"
        value={cTiC}
        min={0}
        max={tiCap}
        step={1}
        onChange={setCTi}
        format={(v) => v > 0 ? `$${v}/sf · ${usd(v * loi.sf)}` : "none"}
        marks={[
          ...(loi.tiPsf > 0 ? [{ at: loi.tiPsf, label: "they asked" }] : [{ at: 0, label: "none" }]),
          ...(loi.tiPsf > 4 ? [{ at: Math.round(loi.tiPsf / 2), label: "half" }] : []),
        ]}
        hint="Cutting fit-out raises net effective the same way raising rent does."
      />
      <Slider
        label="Free rent"
        value={cFreeC}
        min={0}
        max={freeCap}
        step={1}
        onChange={setCFree}
        format={(v) => v > 0 ? `${v} months` : "none"}
        marks={[
          { at: loi.freeM, label: loi.freeM > 0 ? "they asked" : "none" },
        ]}
        hint="Forgone rent, not a signing cheque — it still moves the net effective they judge."
      />
      <Slider
        label="Annual bump"
        value={cBump}
        min={0}
        max={5}
        step={0.25}
        onChange={setCBump}
        format={(v) => `${v.toFixed(2)}%/yr${Math.abs(v - DEFAULT_BUMP_PCT) < 0.01 ? " · market standard" : v > DEFAULT_BUMP_PCT ? " · steeper" : " · flatter"}`}
        marks={[
          { at: openBump, label: "they offered" },
          { at: DEFAULT_BUMP_PCT, label: "2.5%" },
        ]}
        hint="Compounded every anniversary. Steeper than 2.5% raises net effective; flatter gives it away."
      />
      <div className={"loi-ne" + (pushy ? " neg" : soft ? "" : "")}>
        Your NE ${yourNe.toFixed(2)}/sf
        {" · "}
        {vsMkt >= 0 ? "+" : ""}{vsMkt.toFixed(0)}% vs market
        {Math.abs(theirNe - yourNe) > 0.05 ? ` · their opener $${theirNe.toFixed(2)}` : ""}
        {" · "}
        cash to sign {usd(costNow)}
        {cTiC !== loi.tiPsf || cTerm !== loi.termM
          ? ` (was ${usd(loiSigningCost(loi, feeRate))} on their letter)`
          : ""}
      </div>
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-buy"
          onClick={() => onSend(draft)}
        >
          Send counter
        </button>
        <button
          type="button"
          className="btn"
          title="Take-it-or-leave-it. No counter-back — they sign or they walk."
          onClick={() => onSend({ ...draft, bestFinal: true })}
        >
          Best &amp; final
        </button>
        <button type="button" className="btn" onClick={onBack}>Back</button>
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
  const nowNe = netEffectivePsf(loi, loi.rentPsf, loi.tiPsf, loi.freeM, bumpOf(loi));
  const bump = bumpOf(loi);

  return (
    <div className="grid">
      <div className="loi-hero-block">
        <LoiHero loi={loi} />
        <div className="loi-hero-sub mono dim">
          through {monthLabel(game.month + loi.termM)} · {usd(annual)} a year face rent
          {loi.kind === "expansion" && (
            <> · <Gloss term="coterminous">coterminous</Gloss> with their sitting lease</>
          )}
        </div>
      </div>
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
              + (loi.askedFreeM ? ` · ${loi.askedFreeM}mo free` : "")
              + (loi.askedBumpPct !== undefined ? ` · ${loi.askedBumpPct.toFixed(2)}%/yr` : "")
              /* Only when the term was on the table. A save taken mid-
                 negotiation can carry no opener at all, hence the fallback. */
              + (loi.askedTermM !== undefined && loi.askedTermM !== (loi.openTermM ?? loi.termM)
                ? ` · ${(loi.askedTermM / 12).toFixed(1)} yrs`
                : "")}
            strong
          />
          <Row
            k="Their final"
            v={`$${(loi.counterRentPsf ?? loi.rentPsf).toFixed(2)}/sf`
              + (loi.counterTiPsf !== undefined ? ` · TI $${loi.counterTiPsf}` : "")
              + ((loi.counterFreeM ?? 0) > 0 ? ` · ${loi.counterFreeM}mo free` : "")
              + (loi.counterBumpPct !== undefined ? ` · ${loi.counterBumpPct.toFixed(2)}%/yr` : ` · ${bump.toFixed(2)}%/yr`)
              + (loi.askedTermM !== undefined && loi.askedTermM !== (loi.openTermM ?? loi.termM)
                ? ` · ${(loi.termM / 12).toFixed(1)} yrs`
                : "")}
            strong
          />
        </>
      )}
      {!isFinal && <Row k="Rent" v={`$${loi.rentPsf.toFixed(2)}/sf`} strong />}
      {!isFinal && (
        <Row
          k="Annual bump"
          v={`${bump.toFixed(2)}%/yr${Math.abs(bump - DEFAULT_BUMP_PCT) < 0.01 ? " · market standard" : bump > DEFAULT_BUMP_PCT ? " · steeper than standard" : " · flatter than standard"}`}
        />
      )}
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
      <Row k="TI allowance" v={loi.tiPsf > 0 ? `$${loi.tiPsf}/sf · ${usd(loi.tiPsf * loi.sf)}` : "none"} />
      <Row k="Free rent" v={loi.freeM > 0 ? `${loi.freeM} months` : "none"} />
      <Row k="Cash to sign" v={usd(cost)} bad={cost > game.cash} strong />
      {h?.broker && (
        <Row
          k="Your exclusive"
          v={`6% of ${usd(annual * (loi.termM / 12))} of base rent over the term — ${usd(Math.round(annual * (loi.termM / 12) * 0.06))}, inside the number above`}
          /* An exclusive right to lease is paid on every lease signed while it
             holds the file. Taking the pen back on one letter — because it is
             over your desk's signing authority, or because you sign the whole
             book yourself — moves who decides, not who is paid. */
          title="Owed whoever signs: the house holds the file on this building, and the exclusive replaces the 4%/2% an in-house deal costs."
        />
      )}
      <Row k="Answer by" v={monthLabel(loi.expiresM)} />
    </div>
  );
}

export function LoiHeaderSub({ loi, address }: { loi: LOI; address: string }) {
  return (
    <>
      {loi.sector} · credit {CREDIT_LABEL[loi.credit]} · {address}
    </>
  );
}
