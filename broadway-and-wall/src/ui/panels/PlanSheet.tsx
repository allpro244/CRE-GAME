// POSTED LEASING PLAN — the sheet the desk clears against. Phase 4.
import { useEffect, useState } from "react";
import Slider from "@/ui/Slider";
import { useStore } from "@/state/store";
import type { BuiltClass, DeskDigest, PlanRow } from "@/engine/types";
import { monthLabel } from "@/engine/types";
import { agentCashReserve, COMMERCIAL_PLAN_USES, deskHoldsPen, marketClearingPct, planIsLive, planRowFor, STARTER_PLAN_ROW } from "@/engine/leasing";
import { CREDIT_LABEL } from "@/engine/types";
import type { Credit } from "@/engine/types";
import { mixOf } from "@/engine/mix";
import { resolveRec, useRentableSf } from "@/engine/value";
import { usd } from "@/ui/format";
import { Big } from "@/ui/panels/shared";

// The mandate is written per asset type — the same three classes the engine
// posts rows for. Apartments have no row: flats let unit by unit off the
// rent roll, and no letter of intent ever reaches a desk.
const CLASSES: BuiltClass[] = COMMERCIAL_PLAN_USES;
const LABEL: Record<string, string> = { office: "Office", retail: "Retail", industrial: "Industrial" };
const FOLD_KEY = "bw-plan-fold";

/** Which asset-type sheets are open, remembered across sessions. */
function readFolds(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(FOLD_KEY) ?? "{}") ?? {}; } catch { return {}; }
}

function rowOf(game: ReturnType<typeof useStore.getState>["game"], use: BuiltClass): PlanRow {
  return game!.leasingPlan?.sheet[use] ?? { ...STARTER_PLAN_ROW };
}

function DigestCard({ d, title }: { d: DeskDigest; title: string }) {
  const ne = d.signed ? d.signedNeSum / d.signed : NaN;
  const sheet = d.sheetQuoteN ? d.sheetQuoteSum / d.sheetQuoteN : NaN;
  const over = Number.isFinite(ne) && Number.isFinite(sheet) ? sheet - ne : NaN;
  return (
    <div className="agent-bar" style={{ display: "block" }}>
      <div className="agent-title">{title} · {monthLabel(d.startM)}–{monthLabel(d.startM + 2)}</div>
      <div className="stat-strip" style={{ marginTop: 6 }}>
        <Big label="Signed" value={String(d.signed)} />
        <Big label="Avg NE%" value={Number.isFinite(ne) ? `${(ne * 100).toFixed(0)}%` : "—"} />
        <Big label="Walked" value={String(d.walked)} />
        <Big label="Declined" value={String(d.declined)} />
        <Big label="Docketed" value={String(d.referred)} />
        <Big label="Vacant-mo" value={String(d.vacMonths)} />
        <Big label="Capital out" value={usd(d.capitalOut)} />
      </div>
      {Number.isFinite(over) && (
        <div className="hint" style={{ marginTop: 6 }}>
          {over > 0.01
            ? `Plan ${(over * 100).toFixed(0)} pts above signed deals · ${d.vacMonths} vacant-months`
            : over < -0.01
              ? `Deals signed ${(Math.abs(over) * 100).toFixed(0)} pts above plan`
              : "Plan in line with signed deals"}
        </div>
      )}
    </div>
  );
}

export function PlanDigest() {
  const game = useStore((s) => s.game)!;
  if (!planIsLive(game)) return null;
  const prev = game.deskDigestPrev;
  const cur = game.deskDigest;
  if (!prev && !cur) return null;
  return (
    <>
      {prev && <DigestCard d={prev} title="Last quarter" />}
      {cur && <DigestCard d={cur} title="This quarter" />}
    </>
  );
}

/**
 * What you hold in this asset type, so the header says which sheets matter:
 * rentable feet across your buildings that carry the use, and the letters on
 * that use waiting in the tray. A sheet for a class you own nothing in is
 * still posted (the desk reads it the day you buy one) — it just starts folded.
 */
function classExposure(game: ReturnType<typeof useStore.getState>["game"], parcels: ReturnType<typeof useStore.getState>["parcels"], use: BuiltClass) {
  let sf = 0, bldgs = 0;
  if (game && parcels) {
    for (const bbl of Object.keys(game.holdings)) {
      const rec = resolveRec(parcels, game, bbl);
      if (!rec || !(mixOf(rec)[use] ?? 0)) continue;
      const leg = useRentableSf(rec, use);
      if (leg <= 0) continue;
      sf += leg; bldgs++;
    }
  }
  const letters = (game?.lois ?? []).filter((l) => (l.use ?? "office") === use).length;
  return { sf, bldgs, letters };
}

function ClassRow({ use }: { use: BuiltClass }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels);
  const setPlanRow = useStore((s) => s.setPlanRow);
  const row = rowOf(game, use);
  const label = LABEL[use] ?? use;
  const idx = game.econ.effRentIdx?.[use] ?? game.econ.rentIdx?.[use] ?? 0;
  const street = marketClearingPct(game, use);
  const exp = classExposure(game, parcels, use);
  const [open, setOpen] = useState<boolean>(() => {
    const saved = readFolds()[use];
    return saved !== undefined ? saved : exp.sf > 0;
  });
  const [guards, setGuards] = useState(false);
  useEffect(() => {
    try { localStorage.setItem(FOLD_KEY, JSON.stringify({ ...readFolds(), [use]: open })); } catch { /* */ }
  }, [open, use]);
  const guardBits = [
    (row.maxCashPerDeal ?? 0) > 0 ? `≤${usd(row.maxCashPerDeal!)} a deal` : "",
    (row.minCredit ?? 0) > 0 ? `${CREDIT_LABEL[row.minCredit!]}+ credit${(row.minCreditSf ?? 0) > 0 ? ` over ${Math.round(row.minCreditSf! / 1000)}k sf` : ""}` : "",
  ].filter(Boolean);
  const summary = `min ${(row.targetNePct * 100).toFixed(0)}% of market NE · hold ${row.patienceM} mo, then match market`
    + (guardBits.length ? ` · ${guardBits.join(" · ")}` : "");
  const held = exp.sf > 0
    ? `${exp.bldgs} bldg${exp.bldgs === 1 ? "" : "s"} · ${Math.round(exp.sf / 1000)}k sf${exp.letters ? ` · ${exp.letters} LOI${exp.letters === 1 ? "" : "s"}` : ""}`
    : "none held";
  return (
    <div className={"plan-fold" + (open ? " plan-fold-open" : "")}>
      <button
        type="button"
        className="plan-fold-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={open ? "Collapse" : "Expand"}
      >
        <span className="plan-fold-chev">{open ? "▾" : "▸"}</span>
        <span className="plan-fold-name">{label}</span>
        <span className="plan-fold-summary">{summary}</span>
        <span className={"plan-fold-held" + (exp.sf > 0 ? "" : " dim")}>{held}</span>
      </button>
      {open && (
      <div className="plan-fold-body">
      {/* TWO DIALS. The tenant decides on net effective, so the mandate is
          written in net effective: the least you will sign, and how long you
          will wait for it. Whatever package a tenant asks for, the desk asks
          for the rent that reaches this — nobody is turned away for the
          shape of their deal, only for price. */}
      <Slider
        label="Min net effective"
        value={Math.round(row.targetNePct * 100)}
        min={60}
        max={120}
        step={1}
        onChange={(v) => setPlanRow(use, { targetNePct: v / 100 })}
        marks={[{ at: 80, label: "80" }, { at: 92, label: "92" }, { at: 100, label: "par" }, { at: 110, label: "110" }]}
        format={(v) => `${v}% of market NE · ~$${(idx * v / 100).toFixed(2)}/sf/yr`}
        hint={`Net of free rent and TI · market signing at ${(street * 100).toFixed(0)}% of asking`}
      />
      <Slider
        label="Patience"
        value={row.patienceM}
        min={0}
        max={36}
        step={1}
        onChange={(v) => setPlanRow(use, { patienceM: v })}
        marks={[{ at: 0, label: "none" }, { at: 12, label: "1 yr" }, { at: 24, label: "2 yr" }, { at: 36, label: "3" }]}
        format={(v) => v === 0 ? "match market immediately" : `hold ${v} months vacant, then match market`}
        hint="After this, the desk signs at market if below your minimum"
      />
      <button type="button" className="btn" style={{ marginTop: 6 }} onClick={() => setGuards((g) => !g)}>
        {guards ? "▾" : "▸"} Guardrails{guardBits.length ? ` · ${guardBits.length} on` : " · off"}
      </button>
      {guards && (
        <div style={{ marginTop: 6 }}>
          <Slider
            label="Max cash per deal"
            value={Math.round((row.maxCashPerDeal ?? 0) / 25_000)}
            min={0}
            max={80}
            step={1}
            onChange={(v) => setPlanRow(use, { maxCashPerDeal: v > 0 ? v * 25_000 : undefined })}
            format={(v) => v === 0 ? "no cap" : `${usd(v * 25_000)} · excess TI converted to rent`}
          />
          <Slider
            label="Min credit"
            value={row.minCredit ?? 0}
            min={0}
            max={2}
            step={1}
            onChange={(v) => setPlanRow(use, { minCredit: v > 0 ? (v as Credit) : undefined })}
            format={(v) => v === 0 ? "any credit" : `decline under ${CREDIT_LABEL[v]}`}
          />
          {(row.minCredit ?? 0) > 0 && (
            <Slider
              label="…on deals ≥"
              value={Math.round((row.minCreditSf ?? 0) / 1000)}
              min={0}
              max={100}
              step={5}
              onChange={(v) => setPlanRow(use, { minCreditSf: v > 0 ? v * 1000 : undefined })}
              format={(v) => v === 0 ? "all sizes" : `${v}k sf+`}
            />
          )}
        </div>
      )}
      </div>
      )}
    </div>
  );
}

/**
 * RENT RELIEF, ANSWERED BY RULE. Grant when the tenant's own market is soft
 * (re-letting costs more than the cut), on a covenant you trust, for a cut you
 * can live with; decline — or leave to you — the rest. Surrenders stay yours.
 */
function ReliefRule() {
  const game = useStore((s) => s.game)!;
  const { setPlanOptions } = useStore.getState();
  const r = game.leasingPlan?.reliefRule;
  const on = !!r;
  const rule = r ?? { grantIfVacOver: 0.12, minCredit: 1 as Credit, maxCutPct: 0.15, otherwise: "decline" as const };
  const set = (p: Partial<typeof rule>) => setPlanOptions({ reliefRule: { ...rule, ...p } });
  return (
    <div style={{ marginTop: 10 }}>
      <div className="btn-row">
        <button className={"btn" + (on ? " btn-on" : "")}
          onClick={() => setPlanOptions({ reliefRule: on ? undefined : rule })}>
          {on ? "Rent-relief rule · on" : "Rent-relief rule · off"}
        </button>
      </div>
      {on && (
        <div style={{ marginTop: 6 }}>
          <Slider label="Grant if use vacancy ≥" value={Math.round(rule.grantIfVacOver * 100)} min={0} max={30} step={1}
            onChange={(v) => set({ grantIfVacOver: v / 100 })} format={(v) => `${v}%`} />
          <Slider label="…and credit ≥" value={rule.minCredit} min={0} max={2} step={1}
            onChange={(v) => set({ minCredit: v as Credit })} format={(v) => `${CREDIT_LABEL[v]} credit`} />
          <Slider label="…and cut ≤" value={Math.round(rule.maxCutPct * 100)} min={5} max={30} step={1}
            onChange={(v) => set({ maxCutPct: v / 100 })} format={(v) => `${v}% of rent`} />
          <div className="btn-row" style={{ marginTop: 4 }}>
            <button className="btn" onClick={() => set({ otherwise: rule.otherwise === "decline" ? "mine" : "decline" })}>
              {rule.otherwise === "decline" ? "Otherwise: decline" : "Otherwise: refer to you"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PlanEditor() {
  const game = useStore((s) => s.game)!;
  const { setPlanAuthority, setDeskMaxSf, setSignOwnAll } = useStore.getState();
  // Visible whether or not a desk holds the pen: the owner writes the
  // mandate first and hands the pen second. Posted now, it takes effect the
  // month a desk holds the pen.
  const live = deskHoldsPen(game);
  const plan = game.leasingPlan;
  const auth = plan?.authority ?? 1e15;
  const authSf = game.deskMaxSf ?? 0;
  const cashReserve = agentCashReserve(game);
  const preview = plan ? planRowFor(plan, { bbl: "", use: "office", kind: "new" } as never) : null;
  const { setPlanOptions } = useStore.getState();
  const lineAuth = plan?.lineForFitOut ?? 0;
  const seeded = plan?.seededFrom;
  return (
    <div className="agent-bar" style={{ display: "block" }}>
      <div className="agent-title">{live ? "Leasing plan · desk signs" : "Leasing plan · you sign"}</div>
      <div className="hint" style={{ marginBottom: 8 }}>
        {live
          ? "Desk signs within these limits; exceptions referred to you."
          : "Applied by \"Clear the tray\" and \"Counter to my terms\" on Deals."}
        {preview ? ` Office: min ${(preview.targetNePct * 100).toFixed(0)}% NE · hold ${preview.patienceM} mo.` : ""}
        {seeded && seeded !== "default" ? ` Based on your last ${seeded.deals} signings.` : seeded === "default" ? " Default settings." : ""}
      </div>
      {CLASSES.map((u) => <ClassRow key={u} use={u} />)}
      <div className="hint" style={{ marginTop: 6 }}>
        Multifamily: leased at market, no plan.
      </div>
      <div style={{ marginTop: 14 }}>
        <Slider
          label="Dollar authority"
          value={Math.min(200, Math.round((auth >= 1e12 ? 200 : auth) / 1_000_000))}
          min={0}
          max={200}
          step={5}
          onChange={(v) => setPlanAuthority(v <= 0 ? 1e15 : v * 1_000_000)}
          marks={[{ at: 0, label: "none" }, { at: 25, label: "$25M" }, { at: 200, label: "no cap" }]}
          format={(v) => v <= 0 ? "none" : v >= 200 ? "no cap" : `up to $${v}M lease value`}
        />
        <Slider
          label="Signing authority (sf)"
          value={authSf}
          min={0}
          max={100_000}
          step={1_000}
          onChange={(v) => setDeskMaxSf(v)}
          marks={[{ at: 0, label: "no limit" }, { at: 20_000, label: "20k" }, { at: 50_000, label: "50k" }]}
          format={(v) => v <= 0 ? "no limit" : `LOIs over ${v.toLocaleString()} sf referred`}
        />
        <Slider
          label="Line draw for TI"
          value={Math.round(lineAuth / 50_000)}
          min={0}
          max={100}
          step={1}
          onChange={(v) => setPlanOptions({ lineForFitOut: v * 50_000 })}
          format={(v) => v === 0 ? "cash only" : `up to ${usd(v * 50_000)} of the revolver`}
        />
        <ReliefRule />
        <div className="btn-row" style={{ marginTop: 6 }}>
          <button
            className={"btn" + (plan?.tourRule === "mine" ? " btn-on" : "")}
            title="Two tenants, same space"
            onClick={() => setPlanOptions({ tourRule: plan?.tourRule === "mine" ? "best" : "mine" })}
          >
            {plan?.tourRule === "mine" ? "Competing tenants: you pick" : "Competing tenants: desk picks higher NE"}
          </button>
        </div>
        <div className="btn-row" style={{ marginTop: 6 }}>
          <button
            className={"btn" + (game.signOwnAll ? " btn-on" : "")}
            onClick={() => setSignOwnAll(!game.signOwnAll)}
          >
            {game.signOwnAll ? "Sign all yourself · on" : "Sign all yourself · off"}
          </button>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          Cash reserve {usd(cashReserve)} · desk redraws only repaid line{lineAuth > 0 ? " plus TI limit" : ""} · contiguity holds on the stacking plan
        </div>
      </div>
    </div>
  );
}
