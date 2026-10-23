/**
 * THE SPLIT TOOL (engine/lotsplit.ts): the lot drawn as a plat is drawn —
 * street line at the foot, the building hatched, the new lines in red — and
 * cut by hand (drag a line; it squares to the frontage within 8 degrees) or
 * into N equal lots. Every lot is priced and checked against the code live:
 * area, frontage, street access, the zone's minimums, the building's
 * envelope, its value on the engine's own paths. File it from here.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { useStore, splitSite } from "@/state/store";
import type { GameState } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import { monthLabel } from "@/engine/types";
import { splitQuote, splittable, siteAsBuilt, EASE_FT, type SplitPlan } from "@/engine/lotsplit";
import { buildingCuts, cutPieces, equalCuts, fracCut, siteFrame, snapCut, type LL, type SplitCut } from "@/engine/lotsplitGeom";
import { usd } from "@/ui/format";

const FT = 0.3048;
type XY = [number, number];
/** a plan in progress survives leaving the tab */
const DRAFTS = new Map<string, SplitPlan>();

export function SplitTab({ game, parcels, bbl }: { game: GameState; parcels: ParcelTable; bbl: string }) {
  const city = useStore((s) => s.city);
  const file = useStore((s) => s.fileLotSplit);
  const [plan, setPlanRaw] = useState<SplitPlan>(() => DRAFTS.get(bbl) ?? { cuts: [] });
  const [hist, setHist] = useState<SplitPlan[]>([]);
  const setPlan = (p: SplitPlan) => { setHist((h) => [...h.slice(-20), plan]); setPlanRaw(p); DRAFTS.set(bbl, p); };
  // what stands there now: no outline for a building that came down, an outline for one put up in play
  const geo = useMemo(() => { const g0 = city ? splitSite(city, bbl) : null; return g0 ? siteAsBuilt(game, parcels, bbl, g0) : null; }, [city, bbl, game, parcels]);
  const deny = splittable(game, parcels, bbl);
  const q = useMemo(() => (geo ? splitQuote(game, parcels, bbl, geo, plan) : null), [game, parcels, bbl, geo, plan]);
  const pending = (game.splits ?? []).filter((x) => x.parent === bbl && !x.done && !x.lapsed).at(-1);
  const last = (game.splits ?? []).filter((x) => x.parent === bbl || x.pieces.some((p) => p.bbl === bbl)).at(-1);

  if (!geo) return <div className="nx-hosted"><div className="nx-dim">No outline.</div></div>;
  if (pending) {
    return (
      <div className="nx-hosted">
        <div className="nx-strip">
          <Stat label="Filed">{monthLabel(pending.filedM)}</Stat>
          <Stat label={pending.kind === "minor" ? "Sign-off" : "Board"}>{monthLabel(pending.doneM)}</Stat>
          <Stat label="Lots">{pending.pieces.length}</Stat>
          <Stat label="Odds">{Math.round(pending.odds * 100)}%</Stat>
          <Stat label="Fees">{usd(pending.cost)}</Stat>
        </div>
        <SplitMap geo={geo} cuts={pending.cuts} rows={null} plan={null} locked />
      </div>
    );
  }
  const rule = q?.rule;
  const addCut = (c: SplitCut) => setPlan({ ...plan, cuts: [...plan.cuts, c], ease: undefined });
  const tools: { label: string; run: () => void; on?: boolean; title?: string }[] = [
    ...[2, 3, 4].map((n) => ({ label: `${n} equal`, run: () => setPlan({ ...plan, cuts: equalCuts(geo, n), ease: undefined }), title: `${n} lots of equal area, square to the frontage` })),
    { label: "Front / rear", run: () => setPlan({ ...plan, cuts: [fracCut(geo, 0.5, "depth")], ease: undefined }), title: "Rear needs easement" },
    ...(geo.footprints.length && rule ? [{ label: "Excess land", run: () => { const best = buildingCuts(geo, rule.sideFt).map((c) => ({ c, q: splitQuote(game, parcels, bbl, geo, { cuts: [c] }) })).sort((x, y) => Number(y.q.ok) - Number(x.q.ok) || y.q.piecesValue - x.q.piecesValue)[0]; if (best) setPlan({ ...plan, cuts: [best.c], ease: undefined }); }, title: "Beside the building" }] : []),
    { label: "Clear", run: () => setPlan({ cuts: [] }) },
    ...(hist.length ? [{ label: "Undo", run: () => { const h = hist.at(-1)!; setHist(hist.slice(0, -1)); setPlanRaw(h); DRAFTS.set(bbl, h); } }] : []),
  ];
  const ok = !!q?.ok;
  const blank = !plan.cuts.length;
  const why = deny ?? (blank ? null : q?.why[0] ?? null);
  return (
    <div className="nx-hosted nx-split">
      {q && q.lots >= 2 && (
        <div className="nx-strip">
          <Stat label="Lots">{q.lots}</Stat>
          <Stat label="Process">{q.kind === "minor" ? "Minor" : "Plat"}</Stat>
          <Stat label="Fees">{usd(q.cashNow)}</Stat>
          <Stat label="Months">{q.months}</Stat>
          <Stat label="Odds">{Math.round(q.odds * 100)}%</Stat>
          <Stat label="Whole">{usd(q.parentValue)}</Stat>
          <Stat label="Apart" tone={!q.piecesValue ? undefined : q.gain - q.cashNow >= 0 ? "pos" : "neg"}>{q.piecesValue ? usd(q.piecesValue) : "—"}</Stat>
          <Stat label="Net" tone={!q.piecesValue ? undefined : q.gain - q.cashNow - (q.debt?.penalty ?? 0) >= 0 ? "pos" : "neg"}>{q.piecesValue ? usd(q.gain - q.cashNow - (q.debt?.penalty ?? 0)) : "—"}</Stat>
        </div>
      )}
      <div className="nx-split-tools">
        {tools.map((t) => <button key={t.label} type="button" className="nx-btn nx-sm" title={t.title} onClick={t.run}>{t.label}</button>)}
        <span className="nx-dim mono">drag to cut · {rule ? `${q!.zone} ${rule.family} · ≥${rule.minSf.toLocaleString()} sf · ≥${rule.minFt} ft · yard ${rule.sideFt} ft · ≤${rule.ratio}:1` : ""}</span>
      </div>
      <SplitMap geo={geo} cuts={plan.cuts} rows={q?.pieces ?? null} plan={plan} onCut={addCut} />
      {q && q.pieces.length >= 2 && (
        <div className="nx-split-rows"><table className="nx-table">
          <thead>
            <tr><th>Lot</th><th className="num">sf</th><th className="num">Front</th><th className="num">W×D</th><th>Street</th><th>Zone</th><th>Bldg</th><th className="num">Value</th></tr>
          </thead>
          <tbody>
            {q.pieces.map((r) => {
              const zoneOk = r.areaOk && (r.access !== "street" || r.frontOk) && r.ratioOk;
              const easing = r.access === "easement";
              return (
                <tr key={r.i} title={r.why.join(" · ") || undefined}>
                  <td className="mono" title={r.keep ? "keeps the deed (and anything on it)" : "a new deed"}>{r.keep ? <b>{r.i + 1}</b> : r.i + 1}</td>
                  <td className="num mono">{r.a.toLocaleString()}{r.burden ? <span className="nx-dim"> −{r.burden.toLocaleString()}</span> : null}</td>
                  <td className="num mono">{easing ? `${EASE_FT}′ ease` : `${r.f}′`}</td>
                  <td className="num mono">{r.w}×{r.d}</td>
                  <td>
                    {r.access === "street" && <span className="nx-pos">✓{r.corner ? " corner" : ""}</span>}
                    {easing && (
                      <button type="button" className="nx-btn nx-sm nx-on" title="Remove the easement" onClick={() => { const e = { ...(plan.ease ?? {}) }; delete e[r.i]; setPlan({ ...plan, ease: e }); }}>
                        over {r.over! + 1}
                      </button>
                    )}
                    {r.access === "none" && (r.could !== undefined
                      ? <button type="button" className="nx-btn nx-sm" title={`Record a ${EASE_FT}-ft access easement over lot ${r.could + 1}`} onClick={() => setPlan({ ...plan, ease: { ...(plan.ease ?? {}), [r.i]: r.could! } })}>✗ ease → {r.could + 1}</button>
                      : <span className="nx-neg">✗ landlocked</span>)}
                  </td>
                  <td className={zoneOk ? "nx-pos" : "nx-neg"}>{zoneOk ? "✓" : `✗ ${!r.areaOk ? "area" : !r.ratioOk ? "sliver" : "front"}`}</td>
                  <td className={r.conform ? (r.conform.ok ? "nx-pos" : "nx-neg") : "nx-dim"}
                    title={r.conform ? `FAR ${r.conform.far.toFixed(2)}/${r.conform.farMax.toFixed(2)} · cover ${Math.round(r.conform.cov * 100)}%/${Math.round(r.conform.covMax * 100)}% · yard ${r.conform.yardFt.toFixed(1)}/${r.conform.yardMin} ft` : undefined}>
                    {r.conform ? (r.conform.ok ? `✓ FAR ${r.conform.far.toFixed(1)}` : `✗ ${r.conform.why[0].split(" ")[0]}`) : "—"}
                  </td>
                  <td className="num mono">{q.piecesValue ? usd(r.value) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
      {q?.debt && (
        <div className="nx-split-debt">
          <span className="mono">{q.debt.lender} · {usd(q.debt.balance)} · max LTV {Math.round(q.debt.maxLTV * 100)}%</span>
          {q.debt.modes.length > 1 && q.debt.modes.map((m) => (
            <button key={m} type="button" className={"nx-btn nx-sm" + (q.debt!.mode === m ? " nx-on" : "")} onClick={() => setPlan({ ...plan, debt: m })}>{m === "allocate" ? "Split the note" : "Release"}</button>
          ))}
          <span className="mono">consent {usd(q.debt.fee)} · {q.debt.mode === "release" ? "release" : "paydown"} {usd(q.debt.paydown)}{q.debt.penalty ? ` + ${usd(q.debt.penalty)} prepay` : ""} at recording</span>
        </div>
      )}
      <div className="nx-split-foot">
        <span className={"mono " + (why ? "nx-neg" : "nx-dim")}>{why ?? (blank ? "Drag across the lot, or pick equal lots." : q ? `${q.kind === "minor" ? "Staff sign-off" : "Board"} ${monthLabel(game.month + q.months)}` : "")}</span>
        {last?.lapsed && <span className="mono nx-neg">last: {last.lapsed}</span>}
        <button type="button" className="nx-btn nx-primary" disabled={!ok || !!deny} title={why ?? undefined}
          onClick={() => { file(bbl, plan); DRAFTS.delete(bbl); setPlanRaw({ cuts: [] }); setHist([]); }}>
          File split{q && ok ? ` · ${usd(q.cashNow)}` : ""}
        </button>
      </div>
    </div>
  );
}

function Stat({ label, children, tone }: { label: string; children: React.ReactNode; tone?: "pos" | "neg" }) {
  return <div className="nx-stat"><div className="nx-stat-label">{label}</div><div className={"nx-stat-value mono" + (tone ? " nx-" + tone : "")}>{children}</div></div>;
}

/**
 * THE LOT, AS A PLAT: its own frame, frontage along the foot. Streets as their
 * right-of-way with a dashed centreline, the building hatched, the cut lines
 * red, lots numbered with their frontage dimensioned.
 */
function SplitMap({ geo, cuts, rows, plan, onCut, locked }: {
  geo: NonNullable<ReturnType<typeof splitSite>>; cuts: SplitCut[];
  rows: ReturnType<typeof splitQuote>["pieces"] | null; plan: SplitPlan | null; onCut?: (c: SplitCut) => void; locked?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<{ a: XY; b: XY } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  // the drawing frame: x along the frontage, y away from the street (street at the foot)
  const F = useMemo(() => {
    const fr = siteFrame(geo);
    const u = fr.u, n: XY = [-u[1], u[0]];
    const fm: XY = [(fr.front[0][0] + fr.front[1][0]) / 2, (fr.front[0][1] + fr.front[1][1]) / 2];
    const cy = fr.ring.reduce((t, p) => t + (p[0] * n[0] + p[1] * n[1]), 0) / fr.ring.length;
    // the front edge goes to the foot of the sheet; x turns with it so the lot is turned, never mirrored
    // (the sheet's y runs down, so a true rotation of the ground has determinant -1 here)
    const s = fm[0] * n[0] + fm[1] * n[1] < cy ? -1 : 1;
    const to = (p: XY): XY => [-s * (p[0] * u[0] + p[1] * u[1]), s * (p[0] * n[0] + p[1] * n[1])];
    const back = (q: XY): XY => { const a = -s * q[0], b = s * q[1]; return [a * u[0] + b * n[0], a * u[1] + b * n[1]]; };
    const toS = (p: LL) => to(fr.toXY(p));
    const fromS = (q: XY) => fr.toLL(back(q));
    const ring = geo.ring.map(toS);
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    const pad = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.35 + 8;
    return { toS, fromS, ring, view: { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + 2 * pad, h: Math.max(...ys) - Math.min(...ys) + 2 * pad } };
  }, [geo]);
  const v = F.view;
  // metres a screen pixel, so a label is a label at any panel width
  const [px, setPx] = useState<[number, number]>([640, 400]);
  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setPx([el.clientWidth || 640, el.clientHeight || 400]));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // the view is fitted ("meet"): the tighter of the two axes sets the scale
  const mpp = Math.max(v.w / Math.max(100, px[0]), v.h / Math.max(100, px[1]));
  const pieces = useMemo(() => cutPieces(geo.ring, cuts).map((r) => r.map(F.toS)), [geo, cuts, F]);
  const ringD = (r: XY[]) => "M" + r.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join("L") + "Z";
  const lineD = (r: XY[]) => "M" + r.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join("L");
  const toUser = (cx: number, cy: number): XY => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return [0, 0];
    const pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy;
    const q = pt.matrixTransform(m.inverse());
    return [q.x, q.y];
  };
  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (locked || !onCut) return;
    const p = toUser(e.clientX, e.clientY);
    setDrag({ a: p, b: p });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: RPointerEvent<SVGSVGElement>) => { if (drag) setDrag({ ...drag, b: toUser(e.clientX, e.clientY) }); };
  const onUp = () => {
    if (!drag || !onCut) return;
    const d = Math.hypot(drag.b[0] - drag.a[0], drag.b[1] - drag.a[1]);
    setDrag(null);
    if (d < 3) return;
    onCut(snapCut(geo, F.fromS(drag.a), F.fromS(drag.b)));
  };
  // the snapped preview of a line being dragged
  const preview = drag && Math.hypot(drag.b[0] - drag.a[0], drag.b[1] - drag.a[1]) >= 3 ? snapCut(geo, F.fromS(drag.a), F.fromS(drag.b)).map(F.toS) : null;
  const sbFt = [10, 20, 25, 50, 100, 200, 500].find((f) => (f * FT) / mpp >= 70) ?? 500;
  return (
    <div className="plat-wrap nx-split-map">
      <svg ref={svgRef} className={"plat-map" + (locked ? "" : " tool-split")} viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`} preserveAspectRatio="xMidYMid meet"
        style={{ aspectRatio: `${v.w} / ${v.h}`, maxHeight: "46vh" }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setHover(null)}
        role="img" aria-label="Lot split plan">
        <defs>
          <pattern id="nx-split-hatch" patternUnits="userSpaceOnUse" width={5 * mpp} height={5 * mpp} patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2={5 * mpp} stroke="#2b251a" strokeWidth={0.7 * mpp} />
          </pattern>
        </defs>
        <rect x={v.x - v.w} y={v.y - v.h} width={v.w * 3} height={v.h * 3} className="plat-paper" />
        {geo.streets.map((s, i) => <path key={`o${i}`} d={lineD(s.pts.map(F.toS))} className="plat-row-edge" strokeWidth={s.w + 1.4 * mpp} />)}
        {geo.streets.map((s, i) => <path key={`i${i}`} d={lineD(s.pts.map(F.toS))} className="plat-row" strokeWidth={s.w} />)}
        {geo.streets.map((s, i) => <path key={`c${i}`} d={lineD(s.pts.map(F.toS))} className="plat-cl" strokeWidth={0.5 * mpp} strokeDasharray={`${6 * mpp} ${3 * mpp}`} />)}
        {pieces.map((r, i) => {
          const row = rows?.[i];
          const bad = row && !row.ok;
          return (
            <path key={`p${i}`} d={ringD(r)} className={"plat-lot" + (hover === i ? " hov" : "")}
              style={bad ? { fill: "#a8402e", fillOpacity: 0.14 } : row?.keep ? { fill: "#b07f1e", fillOpacity: 0.1 } : undefined}
              onPointerEnter={() => setHover(i)} />
          );
        })}
        {geo.footprints.map((f, i) => <path key={`f${i}`} d={ringD(f.map(F.toS))} fill="url(#nx-split-hatch)" stroke="#2b251a" strokeWidth={0.8 * mpp} />)}
        <path d={ringD(F.ring)} className="plat-boundary" />
        {cuts.map((c, i) => {
          const pts = cutSpan(F.ring, [F.toS(c[0]), F.toS(c[1])]);
          return pts ? <path key={`k${i}`} d={lineD(pts)} stroke="#a8402e" strokeWidth={1.6 * mpp} strokeDasharray={`${5 * mpp} ${2.5 * mpp}`} /> : null;
        })}
        {preview && (() => { const pts = cutSpan(F.ring, preview as [XY, XY]); return pts ? <path d={lineD(pts)} stroke="#a8402e" strokeOpacity={0.6} strokeWidth={1.2 * mpp} /> : null; })()}
        {pieces.map((r, i) => {
          const c = r.reduce((t, p) => [t[0] + p[0] / r.length, t[1] + p[1] / r.length], [0, 0]);
          const row = rows?.[i];
          return (
            <text key={`n${i}`} x={c[0]} y={c[1]} className="plat-num" fontSize={11 * mpp} textAnchor="middle" dominantBaseline="middle">
              {i + 1}{row ? ` · ${row.a.toLocaleString()}` : ""}
            </text>
          );
        })}
        {plan?.ease && rows && Object.entries(plan.ease).map(([k, j]) => {
          const a = pieces[Number(k)], b = pieces[j];
          if (!a || !b) return null;
          const ca = a.reduce((t, p) => [t[0] + p[0] / a.length, t[1] + p[1] / a.length], [0, 0]);
          const cb = b.reduce((t, p) => [t[0] + p[0] / b.length, t[1] + p[1] / b.length], [0, 0]);
          return <path key={`e${k}`} d={lineD([ca, [cb[0], Math.max(...b.map((p) => p[1]))]])} stroke="#5b7f3a" strokeOpacity={0.55} strokeWidth={EASE_FT * FT} />;
        })}
        <g transform={`translate(${v.x + 12 * mpp} ${v.y + v.h - 12 * mpp})`} className="plat-scale">
          {[0, 1, 2, 3].map((k) => <rect key={k} x={(k * sbFt * FT) / 4} y={-3 * mpp} width={(sbFt * FT) / 4} height={3 * mpp} className={k % 2 ? "" : "fill"} strokeWidth={0.6 * mpp} />)}
          <text x={sbFt * FT} y={-6 * mpp} fontSize={9 * mpp} textAnchor="middle">{sbFt} ft</text>
        </g>
      </svg>
    </div>
  );
}

/** Where an infinite line crosses a ring: its two outermost crossings, for drawing. */
function cutSpan(ring: XY[], [a, b]: [XY, XY]): XY[] | null {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const ts: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    const ex = q[0] - p[0], ey = q[1] - p[1];
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / den;
    const s = ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / den;
    if (s >= -1e-9 && s <= 1 + 1e-9) ts.push(t);
  }
  if (ts.length < 2) return null;
  const t0 = Math.min(...ts), t1 = Math.max(...ts);
  return [[a[0] + dx * t0, a[1] + dy * t0], [a[0] + dx * t1, a[1] + dy * t1]];
}
