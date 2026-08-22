// POSTED LEASING PLAN — the sheet the desk clears against. Phase 4.
import Slider from "@/ui/Slider";
import { useStore } from "@/state/store";
import type { BuiltClass, DeskDigest, PlanRow } from "@/engine/types";
import { monthLabel } from "@/engine/types";
import { agentCashReserve, deskHoldsPen, planIsLive, planRowFor, PLAYER_EQUIVALENT_ROW } from "@/engine/leasing";
import { usd } from "@/ui/format";
import { Big } from "@/ui/panels/shared";

const CLASSES: BuiltClass[] = ["office", "retail", "industrial"];

function rowOf(game: ReturnType<typeof useStore.getState>["game"], use: BuiltClass): PlanRow {
  return game!.leasingPlan?.sheet[use]
    ?? { ...PLAYER_EQUIVALENT_ROW, quotePct: 0.90, floorPct: 0.90 };
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
            ? `Your sheet is ${(over * 100).toFixed(0)} points over where deals cleared; you bought ${d.vacMonths} vacant-months with it.`
            : over < -0.01
              ? `Deals cleared ${(Math.abs(over) * 100).toFixed(0)} points over the sheet — the market would have borne more.`
              : "The sheet is about where deals are clearing."}
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

function ClassRow({ use }: { use: BuiltClass }) {
  const game = useStore((s) => s.game)!;
  const setPlanRow = useStore((s) => s.setPlanRow);
  const row = rowOf(game, use);
  const label = use === "office" ? "Office" : use === "retail" ? "Retail" : "Industrial";
  return (
    <div style={{ marginTop: 12 }}>
      <div className="slider-label" style={{ marginBottom: 4 }}>{label}</div>
      <Slider
        label="Asking vs market"
        value={Math.round(row.quotePct * 100)}
        min={70}
        max={120}
        step={1}
        onChange={(v) => setPlanRow(use, { quotePct: v / 100 })}
        marks={[{ at: 90, label: "90" }, { at: 100, label: "par" }, { at: 108, label: "1.08" }]}
        format={(v) => `${v}% of market — no cap at par`}
        hint={row.quotePct > 1
          ? "Above par. The cost is time-on-market, priced by the same indifference model as a counter."
          : "At or under market. Space fills faster; the paper is cheaper for the term."}
      />
      <Slider
        label="Hold the ask"
        value={row.holdM}
        min={0}
        max={36}
        step={1}
        onChange={(v) => setPlanRow(use, { holdM: v })}
        marks={[{ at: 0, label: "now" }, { at: 18, label: "18 mo" }, { at: 36, label: "36" }]}
        format={(v) => v === 0 ? "step down as soon as space sits" : `hold ${v} months of vacancy, then step`}
      />
      <Slider
        label="Step down"
        value={Math.round(row.stepPct * 1000) / 10}
        min={0}
        max={5}
        step={0.5}
        onChange={(v) => setPlanRow(use, { stepPct: v / 100 })}
        format={(v) => `${v} pp per quarter`}
      />
      <Slider
        label="Walk-away floor"
        value={Math.round(row.floorPct * 100)}
        min={70}
        max={Math.round(row.quotePct * 100)}
        step={1}
        onChange={(v) => setPlanRow(use, { floorPct: v / 100 })}
        format={(v) => `${v}% of market — never quote below`}
      />
      <Slider
        label="Max TI"
        value={row.maxTiPsf}
        min={0}
        max={120}
        step={5}
        onChange={(v) => setPlanRow(use, { maxTiPsf: v })}
        format={(v) => v === 0 ? "no TI without you" : `$${v}/sf`}
      />
      <Slider
        label="Max free rent"
        value={row.maxFreeM}
        min={0}
        max={12}
        step={1}
        onChange={(v) => setPlanRow(use, { maxFreeM: v })}
        format={(v) => v === 0 ? "no free months" : `${v} months`}
      />
    </div>
  );
}

export function PlanEditor() {
  const game = useStore((s) => s.game)!;
  const { setPlanAuthority, setDeskMaxSf, setSignOwnAll } = useStore.getState();
  if (!deskHoldsPen(game)) return null;
  const plan = game.leasingPlan;
  const auth = plan?.authority ?? 1e15;
  const authSf = game.deskMaxSf ?? 0;
  const cashReserve = agentCashReserve(game);
  const preview = plan ? planRowFor(plan, { bbl: "", use: "office", kind: "new" } as never) : null;
  return (
    <div className="agent-bar" style={{ display: "block" }}>
      <div className="agent-title">The leasing plan</div>
      <div className="hint" style={{ marginBottom: 8 }}>
        A posted sheet, not four mandate bands. The desk counters every workable
        letter to this ask through the same tenant model you use. Exceptions —
        authority, expansions, tours, off-package, treasury — land on the docket.
        {preview ? ` Office is posting ${(preview.quotePct * 100).toFixed(0)}% of market.` : ""}
      </div>
      {CLASSES.map((u) => <ClassRow key={u} use={u} />)}
      <div style={{ marginTop: 14 }}>
        <Slider
          label="Dollar authority"
          value={Math.min(200, Math.round((auth >= 1e12 ? 200 : auth) / 1_000_000))}
          min={0}
          max={200}
          step={5}
          onChange={(v) => setPlanAuthority(v <= 0 ? 1e15 : v * 1_000_000)}
          marks={[{ at: 0, label: "none" }, { at: 25, label: "$25M" }, { at: 200, label: "no cap" }]}
          format={(v) => v <= 0 ? "no deals without you" : v >= 200 ? "no dollar cap" : `desk may sign up to $${v}M of lease value`}
        />
        <Slider
          label="Signing authority (sf)"
          value={authSf}
          min={0}
          max={100_000}
          step={1_000}
          onChange={(v) => setDeskMaxSf(v)}
          marks={[{ at: 0, label: "no limit" }, { at: 20_000, label: "20k" }, { at: 50_000, label: "50k" }]}
          format={(v) => v <= 0 ? "no size limit" : `letters over ${v.toLocaleString()} sf come to you`}
        />
        <div className="btn-row" style={{ marginTop: 6 }}>
          <button
            className={"btn" + (game.signOwnAll ? " btn-on" : "")}
            onClick={() => setSignOwnAll(!game.signOwnAll)}
          >
            {game.signOwnAll ? "You sign everything · on" : "Nobody signs but you"}
          </button>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          Treasury reserve stays {usd(cashReserve)} — the desk refers rather than draws the line.
          Contiguity holds are set on the building’s stacking list.
        </div>
      </div>
    </div>
  );
}
