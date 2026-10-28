import { LineChart } from "@/ui/Chart";
import { glossFor } from "@/ui/Glossary";
import type { ReactNode } from "react";
import { useStore } from "@/state/store";
import { useHeldGame } from "@/ui/heldGame";
import { CLASS_LABEL } from "@/data/types";
import type { ParcelRecord } from "@/data/types";
import type { GameState, Holding } from "@/engine/types";
import { monthLabel } from "@/engine/types";
import { resolveRec, appraise, physicalOcc as physicalOccupancy, inPlace } from "@/engine/value";
import { occupancyRead } from "@/engine/leasing";
import type { OccRead } from "@/engine/leasing";
import { blockReport } from "@/engine/demand";
import { isMixedUse, uses as usesOf } from "@/engine/mix";
import { usd, sf } from "@/ui/format";
import { locDrawFor } from "@/engine/credit";

/** What to call a building: its dominant use, or "Mixed-Use" when it has none. */
export function useLabel(rec: { class: string; bbl: string; floors: number; unitsRes: number; bldgArea: number; mix?: Record<string, number> }): string {
  if (rec.class === "land") return CLASS_LABEL.land;
  return isMixedUse(rec as never) ? "Mixed-Use" : CLASS_LABEL[dominantOf(rec as never)];
}
export function dominantOf(rec: never): "office" | "retail" | "multifamily" | "industrial" {
  return usesOf(rec)[0] ?? "office";
}
export const devUseLabel = (u: string) => (u === "mixed" ? "Mixed-Use" : CLASS_LABEL[u as "office"]);

/**
 * Physical occupancy of the WHOLE building. It used to be implemented here;
 * it now lives in value.ts, because the engine records it every quarter and
 * one quantity does not get two implementations. The `never` shim keeps the
 * ~7 existing call sites in this file, which pass `rec as never`, untouched.
 */
export function physicalOcc(rec: never, h: { tenants: { sf: number }[]; occ?: number }): number {
  return physicalOccupancy(rec as never as ParcelRecord, h as never as Holding);
}

/**
 * OCCUPANCY THE WAY A LEASING DESK HAS TO READ IT — one answer, shared by the
 * leasing table and the property card.
 *
 * `physicalOcc` above divides by the feet that were BUILT, which is what an
 * appraiser capitalises and what a buyer is quoted, and it stays exactly that.
 * A landlord working the book is asking a different question: of the space I can
 * actually let, how much is let? Those two differ by the vacancy that sits under
 * the smallest tenancy the building demises — the loss factor, rentable against
 * usable — and the difference is why a building could read 92% for twenty-five
 * years with 1,311 unlettable feet in it and no way for the owner to know the
 * last two per cent was not their fault.
 *
 * So the surfaces quote the lettable read and NAME the remainder. The engine
 * answers both (`occupancyRead`); this is only the wrapper that keeps the
 * panels from each computing their own.
 */
export function occRead(rec: ParcelRecord, h: Holding): OccRead {
  return occupancyRead(rec, h);
}

/** "fully let · 1,311 sf unlettable remainder", or just the percentage. */
export function occLabel(r: OccRead): string {
  if (r.fullyLet) return `fully let · ${sf(r.remainderSf)} unlettable`;
  return `${(r.lettableOcc * 100).toFixed(0)}%`;
}

/** Why the two numbers differ, for the cell's tooltip. */
export function occTitle(r: OccRead): string {
  if (!r.remainderSf) return "Leased sf / leasable sf.";
  return `${sf(r.remainderSf)} vacant below minimum suite size; unleasable. `
    + `Physical occupancy ${(r.occ * 100).toFixed(0)}% (appraisal basis).`;
}

/**
 * WHY THERE IS NO `disclosed()` HELPER HERE ANY MORE.
 *
 * There used to be one: it wrapped the seller's disclosure in the shape
 * `holdingNOIYr` expects, so a building on the tape could be priced with the
 * same functions as one you own. Three call sites used it and six did not, and
 * the six went on quoting `noiAfterTaxYr` — the class model, which takes a
 * ParcelRecord and structurally cannot see a rent roll. A helper that half the
 * panel ignores is not a fix; it is a second opinion.
 *
 * So it moved into the engine, where the lender and the comps sheet can reach
 * it too: `disclosureFor` finds what the seller has shown, `asIfOwned` puts it
 * in the shape of a holding, and `inPlace` returns the going-in NOI and the
 * in-place occupancy together with a flag saying whether they are facts or an
 * estimate. `goingIn` below is the thin panel wrapper that resolves the record.
 */

/**
 * THE GOING-IN NUMBERS FOR A BUILDING THE PLAYER IS LOOKING AT, and the flag
 * that says whether they are facts or an estimate.
 *
 * One call, so a panel cannot accidentally quote the market's read on income
 * beside the roll's read on occupancy. `disclosed === false` means nobody has
 * shown you anything, and every label that renders it says so.
 */
export function goingIn(game: GameState, bbl: string, price: number) {
  const parcels = useStore.getState().parcels;
  const rec = parcels ? resolveRec(parcels, game, bbl) : null;
  if (!rec) return { noi: 0, occ: 0, disclosed: false, h: null, rec: null };
  return { ...inPlace(rec, game, bbl, price), rec };
}

// Appraisals are opinions with a range, not the true number.
export function band(bbl: string, value: number): string {
  const a = appraise(bbl, value);
  return `${usd(a.lo)} – ${usd(a.hi)}`;
}
export function apMid(bbl: string, value: number): number {
  return appraise(bbl, value).mid;
}

/**
 * THE FIRM'S LIFE IN ONE LINE — Books and the game-over card. It was a bare
 * polyline: no scale, no dates, no way to read a value off it, on the one
 * chart every run ends on. Now the ordinary LineChart: a y-axis in dollars,
 * the first and last month, and a hover that names any month on the line.
 */
export function NWChart({ data, height = 120 }: { data: number[]; height?: number }) {
  if (!data || data.length < 2) return null;
  const step = Math.max(1, Math.floor(data.length / 360));
  const pts: number[] = [];
  const at: number[] = [];
  for (let i = 0; i < data.length; i += step) { pts.push(data[i]); at.push(i); }
  if (at[at.length - 1] !== data.length - 1) { pts.push(data[data.length - 1]); at.push(data.length - 1); }
  return (
    <LineChart
      series={[{ label: "Net worth", color: "#b07f1e", pts }]}
      height={height}
      yFmt={usd}
      zeroBase
      xLabels={[monthLabel(0), monthLabel(data.length - 1)]}
      xAt={(i) => monthLabel(at[i] ?? 0)}
    />
  );
}

// ---------------------------------------------------------------- parcel card
/**
 * THE DESKS A BUILDING HAS. The property page grew until it was one scroll of
 * eleven unrelated cards — a rent roll, a mortgage, a wrecking bill and a bid
 * list, all in a column. These are the same cards, sorted by which question
 * you opened the page to ask. The docked panel passes no tab and still gets
 * the lot, because there you are glancing rather than working.
 */

export type PropTab = "summary" | "leasing" | "money" | "ops" | "deal" | "build" | "history";

export function annualPayment(principal: number, ratePct: number, years: number): number {
  const r = ratePct / 100 / 12;
  const n = years * 12;
  if (r <= 0) return principal / years;
  return (principal * r) / (1 - Math.pow(1 + r, -n)) * 12;
}

// Counter an off-market ask at YOUR number. One shot; the deeper the cut,
// the likelier they hang up instead of grumbling.

// The credit window, in words rather than an index nobody can calibrate.
export function creditWord(ci: number): string {
  return ci >= 1.08 ? "loose" : ci >= 0.92 ? "open" : ci >= 0.78 ? "selective" : ci >= 0.62 ? "tight" : "shut";
}

export const real = (nom: number | undefined, cpi: number | undefined) => (nom ?? 1) / (cpi || 1);

/**
 * WHERE A CIVIC WORK STANDS, and how much of it the ground already believes.
 *
 * The lifecycle has four stops — rumoured, funded at the hearing, the last two
 * years of digging, open — and the market prices each one: a leak on the
 * rumour, some at the funding vote, most while the hoardings are up, all of it
 * on opening day. The fractions mirror `transitLift` in engine/demand.ts,
 * which is not exported; they are restated here the way STYLE_MAX restates
 * the rivals' covenants on the street desk. If the engine's schedule moves,
 * this must move with it, or the panel quotes a pricing the demand model does
 * not run. (The map has its own three-state `civicStage` for paint — this is
 * the pricing readout, not a second opinion on what to draw.)
 */
export function workStage(
  month: number,
  l: { annM: number; openM: number; rumorM?: number },
): { word: "rumoured" | "funded" | "digging" | "open"; priced: number } {
  if (month >= l.openM) return { word: "open", priced: 1 };
  if (month >= l.openM - 24) return { word: "digging", priced: 0.45 };
  if (month >= l.annM) return { word: "funded", priced: 0.18 };
  // Pre-rumour saves carry works with no rumorM; they load as announced and
  // never render here before their annM, so priced 0 is a dead branch kept
  // for honesty rather than a state a player can see.
  return { word: "rumoured", priced: l.rumorM !== undefined && month >= l.rumorM ? 0.06 : 0 };
}

// Deep links into a desk's views (Players → The street, Markets → Office):
// see ui/deskView.ts.
export { openViewOn, useDeskView } from "@/ui/deskView";

/**
 * A PAGE'S OWN VIEWS, one row, directly under the desk tabs. Every City page
 * that has more than one view uses this, so there is one second-level control
 * in one place rather than button rows, pill rows and lens rows that each page
 * styled for itself.
 */
export function ViewSwitch<T extends string>({ views, on, set, label }: {
  views: readonly { id: T; label: string; n?: number; title?: string }[];
  on: T; set: (v: T) => void; label: string;
}) {
  return (
    <div className="view-switch" role="tablist" aria-label={label}>
      {views.map((v) => (
        <button key={v.id} type="button" role="tab" aria-selected={on === v.id} title={v.title}
          className={"view-chip" + (on === v.id ? " on" : "")} onClick={() => set(v.id)}>
          {v.label}{v.n ? <span className="view-n">{v.n}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Big({ label, value, bad, title }: { label: string; value: string; bad?: boolean; title?: string }) {
  const gloss = title ? undefined : glossFor(label);
  return (
    <div className="big-stat" title={title ?? gloss}>
      <div className={"big-label" + (gloss ? " has-gloss" : "")}>{label}</div>
      {/* A long reading (a band, a label, "3.8 yrs avg") steps down a size
          rather than breaking across two or three lines of a tile. */}
      <div className={"big-value mono" + (bad ? " v-bad" : "") + (value.length > 14 ? " big-value-xl" : value.length > 9 ? " big-value-long" : "")}>{value}</div>
    </div>
  );
}

// Why a corner is getting better, in the terms a principal actually thinks in:
// how many people work here, how many live here, how much of it is open to the
// street — and which of the three is missing. The demand number on the card is
// downstream of exactly these; nothing here is decoration.
// The engine probes the block with a test floorplate of each use and reports
// which one moves it most, so the copy says exactly that — a marginal claim,
// not an assertion about what the block does or doesn't have.
export const WANTS_LABEL: Record<string, string> = {
  office: "Best use for block: Office",
  industrial: "Best use for block: Industrial",
  multifamily: "Best use for block: Housing",
  retail: "Best use for block: Retail",
  mixed: "Best use for block: Mixed use",
};
export function Neighbourhood({ bbl, block }: { bbl: string; block: string }) {
  const game = useHeldGame(bbl);
  const parcels = useStore((s) => s.parcels);
  // block drift moves without touching the holding — keep this readout live
  useStore((s) => s.game?.blockD?.[block] ?? 0);
  if (!parcels) return null;
  const r = blockReport(game, parcels, block);
  if (!r) return null;
  const n = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v));
  const moved = Math.abs(r.drift) >= 0.5;
  return (
    <div className="deal" key={bbl}>
      <div className="deal-head">Neighbourhood (5-min walk)</div>
      <div className="grid">
        <Row k="Jobs" v={n(r.jobs)} />
        <Row k="Residents" v={n(r.residents)} />
        <Row k="Storefront" v={sf(r.amenitySf)} />
        <Row
          k="Since 2000"
          v={moved ? `${r.drift > 0 ? "+" : ""}${r.drift.toFixed(0)} demand` : "unchanged"}
          strong={r.drift > 0.5}
          bad={r.drift < -0.5}
        />
        <Row
          k="Hiring"
          v={Math.abs(r.hiring) < 0.5 ? "in line with city" : `${r.hiring > 0 ? "+" : ""}${r.hiring.toFixed(0)} demand`}
          strong={r.hiring > 0.5}
          bad={r.hiring < -0.5}
        />
        <Row k="Employment mix" v={r.trades.map((t) => `${Math.round(t.share * 100)}% ${t.label.toLowerCase()}`).join(", ")} />
        {r.line ? (() => {
          // The report names the strongest work near this block and what it is
          // worth here at full price; the stage and the priced-in fraction
          // live on the work itself, so find it — name plus opening month is
          // identity enough, since no two works share a corridor.
          const line = r.line;
          const kind = line.kind ?? "station";
          const lw = (game.lines ?? []).find((x) => x.name === line.name && x.openM - game.month === line.monthsOut);
          const st = lw ? workStage(game.month, lw) : null;
          const v = !st || !lw
            ? (line.monthsOut > 0
              ? `${line.name} ${kind}, ${Math.max(1, Math.round(line.monthsOut / 12))} yrs out`
              : `${line.name} ${kind}, open`)
            : st.word === "open"
              ? `${line.name} ${kind} · open · +${line.pts} demand here`
              : `${line.name} ${kind} · ${st.word} · ${st.word === "rumoured" ? `hearing ${monthLabel(lw.annM)}` : `opens ${monthLabel(lw.openM)}`}`
                + ` · +${line.pts} at full value · ${Math.round(st.priced * 100)}% priced in`;
          return <Row k="Transit" v={v} strong />;
        })() : null}
      </div>
      <div className="deal-note">
        {r.balanced
          ? "Balanced block"
          : WANTS_LABEL[r.wants]}
      </div>
    </div>
  );
}

export function Row({ k, v, strong, bad, title }: {
  k: ReactNode; v: string; strong?: boolean; bad?: boolean; title?: string;
}) {
  // A sentence of a value ("$4.15M total · $1.83M drawn as it rises over ~35
  // mo") wrapped to three ragged lines in the map card's right-hand column.
  // Past a line's worth it is marked long; the narrow card drops it under its
  // label, left-aligned, and the wide desks — where it fits — ignore the mark.
  const long = v.length > 34;
  const gloss = title ? undefined : glossFor(k);
  return (
    <>
      <div className={"k" + (gloss ? " has-gloss" : "")} title={title ?? gloss}>{k}</div>
      <div className={"v mono" + (strong ? " v-strong" : "") + (bad ? " v-bad" : "") + (long ? " v-long" : "")} title={title}>{v}</div>
    </>
  );
}

/**
 * THE ONE NUMBER A DESK IS FOR.
 *
 * Every desk in this game prints its facts at one size in one face, which is
 * honest and also means the yield on cost that decides a build, the coverage
 * that decides a refinance and the all-in cost that decides a stack looked
 * exactly like the label beside them. This block is that number, once per
 * desk, large, with the sentence that says which way it cuts. It never
 * replaces the rows underneath it — those are the working — it is the answer.
 */
export function Verdict({ label, value, tone = "flat", note, title }: {
  label: string; value: string; tone?: "good" | "bad" | "warn" | "flat"; note?: ReactNode; title?: string;
}) {
  return (
    <div className={"verdict verdict-" + tone} title={title}>
      <div className="verdict-label">{label}</div>
      <div className="verdict-value mono">{value}</div>
      {note && <div className="verdict-note">{note}</div>}
    </div>
  );
}

/**
 * HOW THE NEXT CHEQUE SPLITS — cash first, then the revolver. Hidden when
 * the whole amount is sitting in the operating account; shown whenever the
 * line is about to move, including a shortfall.
 */
export function LocSplitHint({
  need, game, parcels, allowLoc = true,
}: {
  need: number;
  game: GameState;
  parcels: import("@/data/types").ParcelTable;
  allowLoc?: boolean;
}) {
  const split = locDrawFor(game, parcels, need, { allowLoc });
  if (split.draw <= 0 && split.short <= 0) return null;
  const text = split.short > 0
    ? `${usd(split.cash)} cash · ${usd(split.draw)} line · short ${usd(split.short)}`
    : `${usd(split.cash)} cash · ${usd(split.draw)} line draw at ${split.rate.toFixed(2)}%`;
  return <div className="hint">{text}</div>;
}

// where each style stops borrowing — mirrored from the engine so the sheet can
// say what their own covenant is, not just where they are against it
export const STYLE_MAX: Record<string, number> = {
  family: 0.50, core: 0.65, opportunistic: 0.88, developer: 0.78,
  merchant: 0.80, pe: 0.75, reit: 0.58, vulture: 0.60,
  owneruser: 0.55, foreign: 0.35, slumlord: 0.72,
};

export const CONDITION_WORD: Record<string, string> = {
  good: "good", standard: "average", worn: "worn", obsolete: "obsolete",
};

// What the street calls each kind of shop. The point of the phrasing is that
// it tells you what they WANT, because that is what decides whether they are
// your competition on this building or your buyer for it next year.
export const STYLE_WORD: Record<string, string> = {
  family: "family office",
  core: "institutional",
  opportunistic: "opportunistic",
  developer: "developer",
  merchant: "merchant builder",
  pe: "private equity",
  reit: "listed REIT",
  vulture: "distressed specialist",
  owneruser: "owner-occupier",
  foreign: "offshore capital",
  slumlord: "low-capex landlord",
};

/**
 * WHY THE BUTTON IS GREY, ON THE PAGE. A cash-gated action used to grey out
 * with its reason in a tooltip (or none), so the player had to hover to ask.
 * Renders nothing when the money is there.
 */
export function ShortBy({ need, have, cash = false }: { need: number; have: number; cash?: boolean }) {
  if (have >= need) return null;
  return (
    <span className="hint short-by">
      {cash
        ? `Cash ${usd(Math.max(0, have))} · need ${usd(need)}`
        : `Cash + line ${usd(Math.max(0, have))} · need ${usd(need)}`}
    </span>
  );
}
