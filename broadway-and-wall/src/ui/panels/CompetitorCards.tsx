import { useMemo } from "react";
import { useStore } from "@/state/store";
import type { GameState, Rival } from "@/engine/types";
import { START_YEAR } from "@/engine/types";
import { sheetOf } from "@/engine/rivals";
import { TRAITS, QUIRK_LABEL, HIDDEN_QUIRKS, type TraitKey } from "@/engine/competitorTraits";
import { readOf, bandText } from "@/engine/competitorReads";
import { headliners, labelOf, shownRules, ARC_LABEL, ROLE_LABEL, type Arc } from "@/engine/storyline";
import { LineChart } from "@/ui/Chart";
import { usd } from "@/ui/format";

// THE CAST — COMPETITORS_PLAN.md §6–§7. Who matters right now, what each is in
// the middle of, and what is about to happen to it. Everything here reads the
// engine's own state through engine/storyline.ts and engine/competitorReads.ts;
// none of it can move the economy.

const ARC_TONE: Partial<Record<Arc, string>> = {
  overreaching: "chip-reno", strained: "chip-sweep", crisis: "chip-distress",
  foreclosed: "chip-distress", fireSale: "chip-distress", rescued: "chip-listed",
};

/** The traits a firm is most defined by — furthest from the middle, as you read them. */
function definingTraits(game: GameState, r: Rival, n = 3): { key: TraitKey; label: string; text: string }[] {
  const sheet = sheetOf(r);
  return TRAITS.filter((t) => !t.hidden)
    .map((t) => ({ t, d: Math.abs(sheet[t.key] - 50) }))
    .sort((a, b) => b.d - a.d)
    .slice(0, n)
    .map(({ t }) => ({ key: t.key, label: t.label, text: bandText(readOf(game, r, sheet, t.key)) }));
}

/** Quirks a viewer can see: everything but a hidden one not yet given away. */
function shownQuirks(r: Rival): string[] {
  return (r.quirks ?? [])
    .filter((q) => !HIDDEN_QUIRKS.has(q) || (q === "backer" && r.backerUsedM !== undefined))
    .map((q) => QUIRK_LABEL[q]);
}

export function HeadlinerStrip({ onOpen }: { onOpen: (id: string) => void }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const cast = useMemo(() => headliners(game, parcels), [game, parcels]);
  if (!cast.length) return null;
  return (
    <div className="page-section">
      <div className="page-section-head">The ones to watch</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 8, marginTop: 6 }}>
        {cast.map((h) => (
          <div key={h.r.id} className="deal" style={{ cursor: "pointer", margin: 0 }} onClick={() => onOpen(h.r.id)}
            title="Open the firm's book">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "baseline" }}>
              <strong>{h.r.name}</strong>
              <span className={"chip " + (ARC_TONE[h.arc] ?? "chip-zone")}>{ARC_LABEL[h.arc]}</span>
            </div>
            <div className="dim" style={{ fontSize: 12 }}>
              {h.label}{h.role ? <> · <b>{ROLE_LABEL[h.role]}</b></> : null}
            </div>
            {h.why && <div className="hint" style={{ margin: "4px 0" }}>{h.why}</div>}
            {shownRules(h.r).length > 0 && (
              <div className="chip-row" style={{ margin: "4px 0" }}>
                {shownRules(h.r).map((x) => <span key={x} className="chip chip-zone">{x}</span>)}
              </div>
            )}
            <div className="grid" style={{ margin: "4px 0" }}>
              {definingTraits(game, h.r).map((t) => (
                <div key={t.key} style={{ display: "contents" }}>
                  <div className="k">{t.label}</div><div className="v mono">{t.text}</div>
                </div>
              ))}
            </div>
            {h.coming.length > 0 && (
              <ul style={{ margin: "4px 0 0 16px", padding: 0, fontSize: 12 }}>
                {h.coming.map((c) => <li key={c}>{c}</li>)}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * THE RACE — your net worth against the headliners', a point a year. The
 * firms' points are stamped each January from their own marks (eqHist); yours
 * are the year marks the league table already keeps.
 */
export function RaceChart() {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels)!;
  const cast = useMemo(() => headliners(game, parcels, 5), [game, parcels]);
  const marks = (game.yearMarks ?? []).filter((m) => m.y >= 0);
  const years = Math.max(marks.length, ...cast.map((h) => h.r.eqHist?.length ?? 0));
  if (years < 2) return null;
  const last = marks.length ? marks[marks.length - 1].y + 1 : Math.floor(game.month / 12);
  const first = Math.max(1, last - 29);
  const xs = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const at = (hist: [number, number][] | undefined, y: number) => hist?.find((p) => p[0] === y)?.[1] ?? NaN;
  const palette = ["#6d8fa8", "#a8402e", "#2f5d4a", "#7a5f9e", "#b08d3f"];
  const series = [
    { label: "You", color: "#8a6d1f", pts: xs.map((y) => marks.find((m) => m.y + 1 === y)?.nw ?? NaN) },
    ...cast.map((h, i) => ({ label: h.r.name, color: palette[i % palette.length], pts: xs.map((y) => at(h.r.eqHist, y)) })),
  ];
  return (
    <div className="page-section">
      <div className="page-section-head">The race · net equity, year by year</div>
      <LineChart
        height={150}
        series={series}
        yFmt={(v) => usd(v)}
        xLabels={[String(START_YEAR + first - 1), String(START_YEAR + last - 1)]}
        xAt={(i) => String(START_YEAR + xs[i] - 1)}
      />
    </div>
  );
}

/** THE FIRM'S SHEET, as you know it — the drawer's competitor section. */
export function FirmSheet({ r }: { r: Rival }) {
  const game = useStore((s) => s.game)!;
  const sheet = sheetOf(r);
  const groups = [...new Set(TRAITS.map((t) => t.group))];
  const rules = shownRules(r);
  const quirks = shownQuirks(r);
  const unseen = (r.quirks ?? []).length - quirks.length;
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="page-section" style={{ marginTop: 0 }}>
        {labelOf(r)}
        {!r.sheet && <span className="dim" style={{ fontWeight: 400 }}> · read off its style (an older firm)</span>}
      </div>
      {(rules.length > 0 || quirks.length > 0 || unseen > 0) && (
        <div className="chip-row" style={{ margin: "4px 0 8px" }}>
          {rules.map((x) => <span key={x} className="chip chip-zone">{x}</span>)}
          {quirks.map((x) => <span key={x} className="chip chip-listed">{x}</span>)}
          {unseen > 0 && <span className="chip chip-zone" title="Something about this firm you have not seen yet">???</span>}
        </div>
      )}
      <div className="hint" style={{ marginBottom: 6 }}>
        What you know of them. A range narrows as you trade with them, lose to them and watch what they do on the tape;
        a secretive firm stays hard to read. <span className="mono">??</span> is a trait nothing has given away yet.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "2px 16px" }}>
        {groups.map((g) => (
          <div key={g}>
            <div className="dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 4 }}>{g}</div>
            {TRAITS.filter((t) => t.group === g).map((t) => (
              <div key={t.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }} title={`1: ${t.lo} · 100: ${t.hi}`}>
                <span>{t.label}</span>
                <span className="mono">{bandText(readOf(game, r, sheet, t.key))}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
