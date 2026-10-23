import { derive } from "@/ui/derive";
import { useStore } from "@/state/store";
import type { GameState, Rival } from "@/engine/types";
import { START_YEAR, monthLabel } from "@/engine/types";
import { sheetOf } from "@/engine/rivals";
import { TRAITS, QUIRK_LABEL, HIDDEN_QUIRKS, type TraitKey } from "@/engine/competitorTraits";
import { readOf, bandText, bandValue } from "@/engine/competitorReads";
import { headliners, labelOf, shownRules, ARC_LABEL, ROLE_LABEL, type Arc } from "@/engine/storyline";
import { LineChart } from "@/ui/Chart";
import { thesisLabel } from "@/engine/strategy";
import { movesOf, streetMoves } from "@/engine/firmLog";
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
    .map(({ t }) => ({ key: t.key, label: t.label, text: String(bandValue(readOf(game, r, sheet, t.key))?.v ?? "??") }));
}

/**
 * ONE NUMBER, COLOURED LIKE A SCOUT'S REPORT: red at the bottom of the scale,
 * through amber and yellow, to green at the top. A read you are unsure of is
 * shown fainter; hover for the range it comes from.
 */
export function TraitRating({ band }: { band: [number, number] | null }) {
  const x = bandValue(band);
  if (!x) return <span className="mono dim" title="Nothing has given this away yet">??</span>;
  // Five bands, the way a scouting screen reads at a glance.
  const [bg, fg] = x.v <= 20 ? ["#c0392b", "#fff"] : x.v <= 40 ? ["#e07b24", "#fff"] : x.v <= 60 ? ["#e8c21c", "#2a2410"]
    : x.v <= 80 ? ["#8cc04a", "#1e2a10"] : ["#2f9e44", "#fff"];
  return (
    <span className="mono" title={x.sure >= 0.95 ? "Known" : `Your read: ${bandText(band)} — it narrows as you watch them`}
      style={{
        display: "inline-block", minWidth: 26, textAlign: "center", fontWeight: 700, fontSize: 12,
        padding: "0 4px", borderRadius: 3, color: fg, background: bg,
        opacity: 0.7 + 0.3 * x.sure,
      }}>{x.v}</span>
  );
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
  const cast = derive(game, "street.headliners", () => headliners(game, parcels), [parcels]);
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
  const cast = derive(game, "street.headliners5", () => headliners(game, parcels, 5), [parcels]);
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
      {r.thesis && (
        <div style={{ margin: "2px 0 6px" }} title="What it has told its investors it is doing — it changes course when the plan stops working">
          <span className="dim">The plan: </span>{thesisLabel(r.thesis)}
        </div>
      )}
      {(r.lessons?.length ?? 0) > 0 && (
        <div className="hint" style={{ margin: "0 0 6px" }} title="What happened to this firm that changed how it behaves">
          {r.lessons!.slice(-3).map((l) => l.text).join(" · ")}
        </div>
      )}
      {(rules.length > 0 || quirks.length > 0 || unseen > 0) && (
        <div className="chip-row" style={{ margin: "4px 0 8px" }}>
          {rules.map((x) => <span key={x} className="chip chip-zone">{x}</span>)}
          {quirks.map((x) => <span key={x} className="chip chip-listed">{x}</span>)}
          {unseen > 0 && <span className="chip chip-zone" title="Something about this firm you have not seen yet">???</span>}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "4px 14px", alignItems: "start" }}>
        {groups.map((g) => (
          <div key={g}>
            <div className="dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, margin: "2px 0 3px" }}>{g}</div>
            {TRAITS.filter((t) => t.group === g).map((t) => (
              <div key={t.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, lineHeight: "20px" }}
                title={`1: ${t.lo} · 100: ${t.hi}`}>
                <span>{t.label}</span>
                <TraitRating band={readOf(game, r, sheet, t.key)} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>
        Your read of them, 1–100. Faint numbers are guesses that sharpen as you trade with them and watch the tape; <span className="mono">??</span> has not shown yet.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the firm page

const CLASS_COLOR: Record<string, string> = {
  office: "#3b6fb6", multifamily: "#8a4fb0", retail: "#d9822b", industrial: "#6b7280", land: "#7a9a3a",
};
const MOVE_ICON: Record<string, string> = { buy: "＋", sell: "−", build: "▲", open: "■", plan: "◆", event: "•" };

/** Every parcel's centroid and the town's bounds, computed once per parcel table. */
const townCache = new WeakMap<object, { pts: [number, number][]; w: number; e: number; s: number; n: number }>();
function townShape(parcels: Record<string, { centroid?: [number, number] }>) {
  const hit = townCache.get(parcels);
  if (hit) return hit;
  const pts: [number, number][] = [];
  let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity, i = 0;
  for (const rec of Object.values(parcels)) {
    const c = rec?.centroid;
    if (!c) continue;
    if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0]; if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1];
    if (i++ % 3 === 0) pts.push(c);   // a third of the town is enough to draw its shape
  }
  const out = { pts, w, e, s, n };
  townCache.set(parcels, out);
  return out;
}

/**
 * WHERE THEY OWN. The whole town in faint grey, the firm's buildings coloured
 * by what they are, its cranes ringed, and your own buildings in gold so you
 * can see where you are up against them. Click to see it on the big map.
 */
export function FirmMiniMap({ r, width = 300, height = 210 }: { r: Rival; width?: number; height?: number }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels);
  const showFirmOnMap = useStore((s) => s.showFirmOnMap);
  if (!parcels) return null;
  const t = townShape(parcels as never);
  const sx = (lng: number) => ((lng - t.w) / Math.max(1e-9, t.e - t.w)) * (width - 12) + 6;
  const sy = (lat: number) => (1 - (lat - t.s) / Math.max(1e-9, t.n - t.s)) * (height - 12) + 6;
  const cranes = (game.cityJobs ?? []).filter((j) => j.firmId === r.id && !j.orphaned);
  const pt = (bbl: string) => (parcels as Record<string, { centroid?: [number, number] }>)[bbl]?.centroid;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={`Map of ${r.name}'s buildings`} style={{ background: "rgba(43,37,26,0.04)", borderRadius: 6, cursor: "pointer", display: "block" }}
      onClick={() => showFirmOnMap(r.id)}>
      <title>{`${r.name}: ${r.bbls.length} buildings. Click to see them on the map.`}</title>
      {t.pts.map((c, i) => <circle key={i} cx={sx(c[0])} cy={sy(c[1])} r={0.8} fill="#b9b2a3" opacity={0.45} />)}
      {Object.keys(game.holdings).map((b) => { const c = pt(b); return c ? <circle key={"y" + b} cx={sx(c[0])} cy={sy(c[1])} r={2.6} fill="#c9a227" stroke="#fff" strokeWidth={0.6} /> : null; })}
      {cranes.map((j) => { const c = pt(j.bbl); return c ? <circle key={"c" + j.bbl} cx={sx(c[0])} cy={sy(c[1])} r={5} fill="none" stroke="#c0392b" strokeWidth={1.4} /> : null; })}
      {r.bbls.map((b) => {
        const c = pt(b);
        const rec = (parcels as Record<string, { class?: string; bldgArea?: number }>)[b];
        if (!c) return null;
        const cls = rec && rec.bldgArea ? rec.class ?? "land" : "land";
        return <circle key={b} cx={sx(c[0])} cy={sy(c[1])} r={3.2} fill={CLASS_COLOR[cls] ?? "#555"} stroke="#fff" strokeWidth={0.6} />;
      })}
    </svg>
  );
}

/** What it has done lately, newest first. */
export function FirmMoves({ r, n = 10 }: { r: Rival; n?: number }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels);
  const focus = useStore((s) => s.focus);
  const moves = movesOf(game, r.id, n);
  if (!moves.length) return <div className="dim" style={{ fontSize: 12 }}>Nothing on the record yet — it has been quiet since you arrived.</div>;
  return (
    <div style={{ fontSize: 12, lineHeight: "18px" }}>
      {moves.map((x, i) => (
        <div key={i} style={{ display: "flex", gap: 6, cursor: x.bbl ? "pointer" : undefined }}
          onClick={() => x.bbl && parcels?.[x.bbl] && focus(x.bbl, true)}
          title={x.bbl ? "Show this building" : undefined}>
          <span className="dim mono" style={{ minWidth: 62 }}>{monthLabel(x.m)}</span>
          <span style={{ minWidth: 12, color: x.kind === "buy" ? "#2f9e44" : x.kind === "sell" ? "#c0392b" : x.kind === "build" || x.kind === "open" ? "#3b6fb6" : "#8a6d1f" }}>{MOVE_ICON[x.kind]}</span>
          <span style={{ flex: 1 }}>{x.text}</span>
          {x.px ? <span className="mono dim">{usd(x.px)}</span> : null}
        </div>
      ))}
    </div>
  );
}

/** A firm in one glance: its map, its record, its numbers, then its sheet. */
export function FirmPage({ r }: { r: Rival }) {
  const game = useStore((s) => s.game)!;
  const showFirmOnMap = useStore((s) => s.showFirmOnMap);
  const born = START_YEAR + Math.floor(Math.max(0, r.bornM ?? 0) / 12);
  const counts: Record<string, number> = {};
  const parcels = useStore((s) => s.parcels);
  for (const b of r.bbls) {
    const rec = parcels?.[b];
    const k = rec && rec.bldgArea ? rec.class : "land";
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const feud = r.feud ? game.rivals.find((x) => x.id === r.feud) : undefined;
  const tie = game.street?.[r.id];
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <FirmMiniMap r={r} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 11, marginTop: 4 }}>
            {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <span key={k}><span style={{ color: CLASS_COLOR[k] }}>●</span> {v} {k === "multifamily" ? "apartments" : k}</span>
            ))}
            <span><span style={{ color: "#c9a227" }}>●</span> yours</span>
          </div>
          <button type="button" className="btn" style={{ marginTop: 6 }} onClick={() => showFirmOnMap(r.id)}>Show {r.name} on the map</button>
        </div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="dim" style={{ fontSize: 12, marginBottom: 4 }}>
            Since {born}{r.home && parcels ? ` · home turf ${districtName(parcels, r.home)}` : ""}
            {feud ? ` · feuding with ${feud.name}` : ""}
            {tie ? ` · with you: ${tie.deals} deal${tie.deals === 1 ? "" : "s"}${tie.beats ? `, beat you ${tie.beats}×` : ""}${tie.insults ? `, insulted ${tie.insults}×` : ""}` : ""}
          </div>
          {(r.career?.length ?? 0) > 0 && (
            <>
              <div className="dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, margin: "6px 0 3px" }}>Career</div>
              <div style={{ fontSize: 12, lineHeight: "18px" }}>
                {[...(r.career ?? [])].reverse().map((c, i) => (
                  <div key={i} style={{ display: "flex", gap: 6 }}>
                    <span className="dim mono" style={{ minWidth: 62 }}>{monthLabel(c.m)}</span>
                    <span style={{ flex: 1 }}>{c.text}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, margin: "6px 0 3px" }}>Lately</div>
          <FirmMoves r={r} />
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <FirmSheet r={r} />
      </div>
    </div>
  );
}

function districtName(parcels: Record<string, { district?: string; districtName?: string }>, key: string): string {
  for (const rec of Object.values(parcels)) if (rec?.district === key) return rec.districtName ?? key;
  return key;
}

/** The three traits that most define a firm, as coloured badges. */
export function SignatureTraits({ r }: { r: Rival }) {
  const game = useStore((s) => s.game)!;
  const sheet = sheetOf(r);
  const top = TRAITS.filter((t) => !t.hidden)
    .map((t) => ({ t, d: Math.abs(sheet[t.key] - 50) }))
    .sort((a, b) => b.d - a.d).slice(0, 3);
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      {top.map(({ t }) => (
        <span key={t.key} style={{ display: "inline-flex", gap: 3, alignItems: "center", fontSize: 11 }}>
          <span className="dim">{t.label.split(" ")[0]}</span>
          <TraitRating band={readOf(game, r, sheet, t.key)} />
        </span>
      ))}
    </span>
  );
}

/** What the whole street did lately — a ticker at the top of the page. */
export function StreetTicker({ onOpen }: { onOpen: (id: string) => void }) {
  const game = useStore((s) => s.game)!;
  const moves = streetMoves(game, game.month - 6, 8);
  if (!moves.length) return null;
  const nameOf = (id: string) => game.rivals.find((x) => x.id === id)?.name ?? "A firm";
  return (
    <div style={{ margin: "4px 0 12px", padding: "8px 10px", background: "rgba(43,37,26,0.04)", borderRadius: 6 }}>
      <div className="dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>On the street lately</div>
      {moves.map((x, i) => (
        <div key={i} style={{ display: "flex", gap: 6, fontSize: 12, lineHeight: "18px", cursor: "pointer" }} onClick={() => onOpen(x.firmId)}>
          <span className="dim mono" style={{ minWidth: 62 }}>{monthLabel(x.m)}</span>
          <span style={{ minWidth: 12, color: x.kind === "buy" ? "#2f9e44" : x.kind === "sell" ? "#c0392b" : x.kind === "build" || x.kind === "open" ? "#3b6fb6" : "#8a6d1f" }}>{MOVE_ICON[x.kind]}</span>
          <span style={{ flex: 1 }}><strong style={{ fontWeight: 600 }}>{nameOf(x.firmId)}</strong> — {x.text.charAt(0).toLowerCase() + x.text.slice(1)}</span>
          {x.px ? <span className="mono dim">{usd(x.px)}</span> : null}
        </div>
      ))}
    </div>
  );
}
