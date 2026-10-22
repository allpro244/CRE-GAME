// THE LAND DEVELOPMENT DESK (region map): a farm tract you own, laid out as a
// subdivision in three steps, like the Build desk —
//
//   PROGRAMME   the street pattern, the lot-size mix, the density, with the
//               land budget counted live;
//   DESIGN      the plat itself, drawn as a plat is drawn — thin linework,
//               numbered lots, named streets, the floodplain hatched, a north
//               arrow and a scale — and edited by hand: slide and turn the
//               street pattern, merge, split or give up lots, set down the
//               pond and the amenities from the palette;
//   FINANCING   the A&D loan, the equity, and the commitment: file the
//               rezoning with this plat, or build its streets.
//
// Every number is the engine's (engine/platdesign.ts designPnl / adQuote, the
// homebuilder's residual in homeprice.ts); the geometry is citygen's
// (region/platdesign.mjs). The desk recomputes the whole plat on every edit.
import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { useStore } from "@/state/store";
import { useHeldGame } from "@/ui/heldGame";
import { monthLabel, type PlatDesign, type AmenityKind } from "@/engine/types";
import { platTractDesign, designSummary, LOT_DIM_FT, canSplit } from "@/citygen/index.mjs";
import {
  AMENITIES, AMENITY_KINDS, DESIGN_LOT_SIZES, defaultDesign, designRecipe, designPnl, adQuote, lotPremium,
  type DesignPnl,
} from "@/engine/platdesign";
import { entitleQuote } from "@/engine/landdev";
import { usd } from "@/ui/format";
import { Row, Verdict } from "@/ui/panels/shared";

type Tab = "programme" | "design" | "financing";
type Tool = "hand" | "move" | "merge" | "split" | "open" | "pond" | AmenityKind;
const TABS: { id: Tab; label: string }[] = [{ id: "programme", label: "Programme" }, { id: "design", label: "Design" }, { id: "financing", label: "Financing" }];
const LAYOUTS: { id: PlatDesign["layout"]; label: string }[] = [{ id: "grid", label: "Grid" }, { id: "loops", label: "Loops" }, { id: "culdesac", label: "Cul-de-sacs" }];
const FT = 0.3048;
const SHORT: Record<AmenityKind, string> = { pocket: "POCKET PARK", park: "PARK", greenway: "GREENWAY", playground: "PLAYGROUND", pool: "POOL & CLUB", entry: "ENTRY", fields: "FIELDS" };
const M = (n: number) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1000).toLocaleString()}k`);
const P1 = (x: number) => `${(x * 100).toFixed(1)}%`;
const irrText = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);

// a design in progress survives leaving the tab (and a reload, where storage is allowed)
const DRAFTS = new Map<string, PlatDesign>();
const draftKey = (seed: number, bbl: string) => `bw:platdraft:${seed}:${bbl}`;
function loadDraft(seed: number, bbl: string): PlatDesign | null {
  const m = DRAFTS.get(bbl);
  if (m) return m;
  try { const s = localStorage.getItem(draftKey(seed, bbl)); return s ? JSON.parse(s) as PlatDesign : null; } catch { return null; }
}
function saveDraft(seed: number, bbl: string, d: PlatDesign) {
  DRAFTS.set(bbl, d);
  try { localStorage.setItem(draftKey(seed, bbl), JSON.stringify(d)); } catch { /* storage blocked */ }
}

export default function LandDesk({ bbl }: { bbl: string }) {
  const game = useHeldGame(bbl);
  const parcels = useStore((s) => s.parcels)!;
  const fileDesigned = useStore((s) => s.fileDesignedRezoning);
  const buildDesigned = useStore((s) => s.buildDesignedPlat);
  const rec = parcels[bbl];
  const tract = rec?.tract;
  const owned = !!game.holdings[bbl];
  const app = game.entitlementApps?.[bbl];
  const rz = game.rezoned?.[bbl];
  const plat = game.plats?.[bbl];
  // what is on file is fixed: a pending application's plat, a plat being built
  const locked = !!app || !!plat;
  const [design, setDesignRaw] = useState<PlatDesign>(() =>
    plat?.design ?? app?.design ?? loadDraft(game.seed, bbl) ?? rz?.design ?? defaultDesign());
  const [hist, setHist] = useState<PlatDesign[]>([]);
  const [tab, setTab] = useState<Tab>("design");
  const [lev, setLev] = useState(1);
  useEffect(() => { if (plat?.design) setDesignRaw(plat.design); else if (app?.design) setDesignRaw(app.design); }, [plat?.design, app?.design]);
  const setDesign = (d: PlatDesign, record = true) => {
    if (locked) return;
    if (record) setHist((h) => [...h.slice(-40), design]);
    setDesignRaw(d);
    saveDraft(game.seed, bbl, d);
  };
  const undo = () => { const h = hist.at(-1); if (!h) return; setHist(hist.slice(0, -1)); setDesignRaw(h); saveDraft(game.seed, bbl, h); };

  const buildableSf = rec?.buildableSf ?? rec?.lotArea ?? 0;
  const key = JSON.stringify(design);
  const { geo, summary, ms } = useMemo(() => {
    if (!tract) return { geo: null, summary: null, ms: 0 };
    const t0 = performance.now();
    const g = platTractDesign(tract, designRecipe(design, buildableSf));
    return { geo: g, summary: designSummary(g), ms: performance.now() - t0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tract, key, buildableSf]);
  const pnl = useMemo(() => (geo && summary ? designPnl(game, parcels, bbl, design, summary) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [game, parcels, bbl, summary]);
  const ad = useMemo(() => (pnl ? adQuote(game, pnl, lev) : null), [game, pnl, lev]);
  if (!rec?.ag || !tract || !geo || !summary || !pnl) return null;
  // A TRACT NO PLAT FITS: most of the land by town is the river's floodplain,
  // and a plat of nothing is not a desk. Say so, once, and stop.
  if (!plat && !app && pnl.lots < 4) {
    return (
      <div className="deal land-desk">
        <div className="deal-head">Land development <span className="dim">· not developable</span></div>
        <div className="hint">{(rec.lotArea / 43560).toFixed(0)} ac · {pnl.density.buildableAc.toFixed(1)} buildable{rec.floodShare ? ` · ${Math.round(rec.floodShare * 100)}% floodplain` : ""} · no plat fits. It trades as farmland.</div>
      </div>
    );
  }

  const eq = !rz && !app ? entitleQuote(game, parcels, bbl, 7500, Math.max(4, pnl.lots)) : null;
  const tone = pnl.profit > 0 && (pnl.irr ?? 0) > 0.15 ? "good" : pnl.profit > 0 ? "warn" : "bad";
  const status = plat ? (plat.done ? "platted" : `streets going in · done ${monthLabel(plat.doneM)}`)
    : app ? `before the board · decides ${monthLabel(app.decideM)} · ${Math.round(app.odds * 100)}% odds`
    : rz ? `rezoned ${rz.zone}${rz.lots ? ` · ${rz.lots} lots approved` : ""}` : "zoned AG";
  return (
    <div className={"deal land-desk" + (tab === "design" ? " dev-wide" : "")}>
      <div className="deal-head">Land development <span className="dim">· {status}</span></div>
      <div className="hint">{(rec.lotArea / 43560).toFixed(0)} ac · {pnl.density.buildableAc.toFixed(1)} buildable · {(tract.edgeM / 1000).toFixed(1)} km out · new house here {M(pnl.house.price)} ({pnl.house.sf.toLocaleString()} sf)</div>
      <Verdict
        label={`Profit · ${pnl.lots} lots · ${design.amen.length ? `${design.amen.length} amenit${design.amen.length === 1 ? "y" : "ies"}` : "no amenities"}`}
        value={`${pnl.profit >= 0 ? "" : "−"}${M(Math.abs(pnl.profit))} · IRR ${irrText(pnl.irr)}`}
        tone={tone}
        note={pnl.revenue <= 0
          ? "No builder pays for a lot here today: the house this lot carries is worth less than it costs to build. Most dirt does not pencil."
          : `Lots at the builders' residual ${M(pnl.revenue)} against ${M(pnl.cost)} all in; sold out over ~${Number.isFinite(pnl.selloutM) ? pnl.selloutM : "∞"} months at ${pnl.pace.toFixed(1)} a month.`}
      />
      <PnlStrip pnl={pnl} />
      <div className="stepper" role="tablist" aria-label="Land development desk">
        {TABS.map((t, i) => {
          const at = TABS.findIndex((x) => x.id === tab);
          return (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
              className={"stepper-step" + (tab === t.id ? " on" : i < at ? " done" : "")} onClick={() => setTab(t.id)}>
              <span className="stepper-n" aria-hidden="true">{i < at ? "✓" : i + 1}</span>{t.label}
            </button>
          );
        })}
      </div>
      {tab === "programme" && <Programme design={design} setDesign={setDesign} locked={locked} geo={geo} pnl={pnl} tract={tract} buildableSf={buildableSf} />}
      {tab === "design" && (
        <PlatMap design={design} setDesign={setDesign} remember={(d) => setHist((h) => [...h.slice(-40), d])} undo={hist.length ? undo : undefined} locked={locked}
          geo={geo} pnl={pnl} address={rec.address} acres={rec.lotArea / 43560} ms={ms} />
      )}
      {tab === "financing" && ad && (
        <div className="land-fin">
          <div className="page-section-head">A&amp;D loan · {ad.lender}</div>
          <div className="grid">
            <Row k="Offered" v={`${P1(ad.ltcMax)} of cost · ${ad.ratePct.toFixed(2)}% floating · ${ad.termM} mo IO, recourse`} />
            <Row k="Taken" v={`${M(ad.loan)} · ${pnl.cost > 0 ? P1(ad.loan / pnl.cost) : "—"} LTC`} strong />
            <Row k="Funds the streets" v={M(ad.funded)} />
            <Row k="Interest reserve" v={`${M(ad.reserve)} · lender carries the coupon`} />
            <Row k="Points · rate cap" v={`${M(ad.points)} · ${M(ad.cap)}`} />
            <Row k="Release" v={`${M(ad.loan / Math.max(1, pnl.lots))} a lot, out of each closing`} />
          </div>
          <div className="btn-row" style={{ marginTop: 6 }} role="radiogroup" aria-label="A&D loan">
            {[0, 0.5, 0.75, 1].map((v) => (
              <button key={v} type="button" className={"btn-mini" + (Math.abs(lev - v) < 1e-9 ? " on" : "")} onClick={() => setLev(v)}>
                {v === 0 ? "No loan" : v === 1 ? "All offered" : `${Math.round(v * 100)}% of offer`}
              </button>
            ))}
          </div>
          {ad.why && <div className="hint">{ad.why}</div>}
          <div className="page-section-head" style={{ marginTop: 8 }}>Equity</div>
          <div className="grid">
            <Row k="At the streets" v={`${M(ad.equityNow)} · horizontal less the advance, fees`} strong />
            <Row k="All in" v={`${M(ad.equityAll)} · with land ${M(pnl.land)}${pnl.entitle ? ` and rezoning ${M(pnl.entitle)}` : ""}`} />
            <Row k="IRR" v={`${irrText(ad.irr)} levered · ${irrText(pnl.irr)} unlevered`} strong bad={(ad.irr ?? -1) < 0} />
          </div>
          <div className="page-section-head" style={{ marginTop: 8 }}>Commit</div>
          {!owned && <div className="hint">Buy the tract first.</div>}
          {owned && !rz && !app && eq && (
            <>
              <div className="grid">
                <Row k="Rezone to" v={`${eq.zone} · ${pnl.lots} lots on this plat`} />
                <Row k="Counsel, studies, hearings" v={usd(eq.cost)} />
                <Row k="Board decides in" v={`${eq.months} months · ${Math.round(eq.odds * 100)}% pass`} />
              </div>
              <div className="hint">The board approves this plat's lot count. The final plat may have fewer lots or another mix; more lots is a new application.</div>
              <button type="button" className="btn btn-buy" onClick={() => fileDesigned(bbl, design)}>File the rezoning with this plat · {usd(eq.cost)}</button>
            </>
          )}
          {app && <div className="hint">Before the board: decides {monthLabel(app.decideM)}, {app.lots} lots, {Math.round(app.odds * 100)}% odds. The plat is on file and fixed until then.</div>}
          {owned && rz && !plat && (
            <>
              {rz.lots !== undefined && pnl.lots > rz.lots && <div className="hint alarm">{pnl.lots} lots against {rz.lots} approved. Take lots out (merge, open space, an amenity) or file again.</div>}
              <button type="button" className="btn btn-buy" disabled={rz.lots !== undefined && pnl.lots > rz.lots}
                onClick={() => buildDesigned(bbl, design, lev)}>
                Build the streets · {M(ad.equityNow)} yours{ad.loan > 0 && lev > 0 ? ` · ${M(ad.loan)} A&D` : ""}
              </button>
            </>
          )}
          {plat && <div className="hint">{plat.done ? "Platted: the lots are deeds. Sell them to the builders from a lot's card." : `Streets going in, finished ${monthLabel(plat.doneM)}.`}</div>}
        </div>
      )}
    </div>
  );
}

/** THE P&L, ALWAYS IN VIEW: every line the engine prices, recomputed on each edit. */
function PnlStrip({ pnl }: { pnl: DesignPnl }) {
  const cells: [string, string, boolean?][] = [
    ["Lots", String(pnl.lots)],
    ["Land", M(pnl.land)],
    ["Rezoning", pnl.entitleSpent ? "spent" : M(pnl.entitle)],
    ["Streets", M(pnl.streets)],
    ["Impact", M(pnl.impact)],
    ["Amenities", M(pnl.amenTotal)],
    ["Lot sales", M(pnl.revenue)],
    ["Margin", Number.isFinite(pnl.margin) ? P1(pnl.margin) : "—", pnl.margin < 0],
    ["IRR", irrText(pnl.irr), (pnl.irr ?? -1) < 0],
  ];
  return (
    <div className="pnl-strip" title="Land at basis; rezoning, streets and impact fees at the engine's quotes; lots at each lot's builder residual (the house price with its premium, less build, sell, carry and margin); IRR over the board, the streets and the builders' takedown pace.">
      {cells.map(([k, v, bad]) => (
        <div key={k} className="pnl-cell"><div className="pnl-k">{k}</div><div className={"pnl-v mono" + (bad ? " neg" : "")}>{v}</div></div>
      ))}
    </div>
  );
}

type Geo = ReturnType<typeof platTractDesign>;

function Programme({ design, setDesign, locked, geo, pnl, tract, buildableSf }: {
  design: PlatDesign; setDesign: (d: PlatDesign) => void; locked: boolean; geo: Geo; pnl: DesignPnl;
  tract: NonNullable<import("@/data/types").ParcelRecord["tract"]>; buildableSf: number;
}) {
  // a new pattern, mix or frame changes every base lot, so lot edits made on the old one go
  const reframe = (p: Partial<PlatDesign>) => setDesign({ ...design, ...p, open: [], merge: [], split: [] });
  const total = DESIGN_LOT_SIZES.reduce((t, s) => t + (design.mix[s] ?? 0), 0) || 1;
  const bySize = new Map<number, number>();
  for (const l of geo.lots) bySize.set(l.size, (bySize.get(l.size) ?? 0) + 1);
  const edits = design.open.length + design.merge.length + design.split.length;
  // TARGET DENSITY: the nearest of the single sizes and the even blends of neighbours, by gross density
  const target = (du: number) => {
    const cands: PlatDesign["mix"][] = [
      ...DESIGN_LOT_SIZES.map((s) => ({ [s]: 1 })),
      ...DESIGN_LOT_SIZES.slice(0, -1).map((s, i) => ({ [s]: 1, [DESIGN_LOT_SIZES[i + 1]]: 1 })),
    ];
    let best = cands[0], err = Infinity;
    for (const mix of cands) {
      const g = platTractDesign(tract, designRecipe({ ...design, mix }, buildableSf));
      const d = g.lots.length / Math.max(1e-9, g.ground.grossSf / 43560);
      if (Math.abs(d - du) < err) { err = Math.abs(d - du); best = mix; }
    }
    reframe({ mix: best });
  };
  const sh = pnl.shares;
  return (
    <div className="land-prog">
      <div className="page-section-head">Street pattern</div>
      <div className="btn-row">
        {LAYOUTS.map((l) => (
          <button key={l.id} type="button" disabled={locked} className={"btn-mini" + (design.layout === l.id ? " on" : "")} onClick={() => reframe({ layout: l.id })}>{l.label}</button>
        ))}
      </div>
      <div className="page-section-head" style={{ marginTop: 8 }}>Lot mix</div>
      <table className="tbl land-mix">
        <thead><tr><th>Lot</th><th className="num">ft</th><th>Share</th><th className="num">Lots</th><th className="num">Bid</th></tr></thead>
        <tbody>
          {DESIGN_LOT_SIZES.map((s) => {
            const share = (design.mix[s] ?? 0) / total;
            const [w, d] = LOT_DIM_FT[s];
            const idx = geo.lots.map((l, i) => (l.size === s ? i : -1)).filter((i) => i >= 0);
            const bid = idx.length ? idx.reduce((t, i) => t + pnl.resid[i], 0) / idx.length : 0;
            return (
              <tr key={s} style={{ cursor: "default" }}>
                <td>{s.toLocaleString()} sf</td>
                <td className="num dim">{w}×{d}</td>
                <td>
                  <input type="range" min={0} max={100} step={5} disabled={locked} value={Math.round(share * 100)} aria-label={`${s} sf share`}
                    onChange={(e) => reframe({ mix: { ...design.mix, [s]: Number(e.target.value) } })} />
                  <span className="mono dim"> {Math.round(share * 100)}%</span>
                </td>
                <td className="num">{bySize.get(s) ?? 0}</td>
                <td className="num">{idx.length ? M(bid) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="btn-row">
        {DESIGN_LOT_SIZES.map((s) => (
          <button key={s} type="button" disabled={locked} className="btn-mini" onClick={() => reframe({ mix: { [s]: 1 } })}>All {s / 1000}k</button>
        ))}
        <span className="dim" style={{ marginLeft: 8, fontSize: 11 }}>Target</span>
        {[2, 3, 4, 5].map((du) => (
          <button key={du} type="button" disabled={locked} className="btn-mini" onClick={() => target(du)}>{du} du/ac</button>
        ))}
      </div>
      <div className="page-section-head" style={{ marginTop: 8 }}>Density</div>
      <div className="grid">
        <Row k="Lots" v={`${pnl.lots} · ${pnl.premLots} with a premium`} strong />
        <Row k="Gross · net" v={`${pnl.density.gross.toFixed(2)} · ${pnl.density.net.toFixed(2)} du/ac`} />
        <Row k="Buildable" v={`${pnl.density.buildableAc.toFixed(1)} ac of ${(geo.ground.grossSf / 43560).toFixed(1)} (floodplain ${(geo.ground.floodSf / 43560).toFixed(1)})`} />
        {edits > 0 && <Row k="Hand edits" v={`${design.merge.length} merged · ${design.split.length} split · ${design.open.length} open`} />}
      </div>
      <div className="land-bar" aria-label="Land budget">
        {([["lots", sh.lots, "Lots"], ["streets", sh.streets, "Streets"], ["open", sh.open, "Parks & open"], ["pond", sh.pond, "Detention"], ["flood", sh.flood, "Floodplain"], ["other", sh.other, "Unplatted"]] as const).map(([k, v, label]) => (
          v > 0.002 ? <div key={k} className={"land-bar-seg seg-" + k} style={{ flexGrow: v }} title={`${label} ${P1(v)}`} /> : null
        ))}
      </div>
      <div className="land-bar-key">
        {([["lots", sh.lots, "Lots"], ["streets", sh.streets, "Streets"], ["open", sh.open, "Parks"], ["pond", sh.pond, "Pond"], ["flood", sh.flood, "Flood"], ["other", sh.other, "Other"]] as const).map(([k, v, label]) => (
          <span key={k}><i className={"seg-" + k} />{label} {Math.round(v * 100)}%</span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the plat
const TOOLS: { id: Tool; label: string; title: string }[] = [
  { id: "hand", label: "Look", title: "Hover a lot for its numbers; drag to pan, wheel to zoom" },
  { id: "move", label: "Move streets", title: "Drag to slide the street pattern; drag the round handle to turn it (snaps to 5 m and 1°, sticks at square)" },
  { id: "merge", label: "Merge", title: "Click a lot to merge it with the next lot along its street" },
  { id: "split", label: "Split", title: "Click a lot to split it in two (each half at least 5,000 sf on 40 ft)" },
  { id: "open", label: "Open space", title: "Click a lot to give it to the association as open space; click again to take it back" },
  { id: "pond", label: "Pond", title: "Click where the detention pond goes" },
];

function PlatMap({ design, setDesign, remember, undo, locked, geo, pnl, address, acres, ms }: {
  design: PlatDesign; setDesign: (d: PlatDesign, record?: boolean) => void; remember: (prev: PlatDesign) => void; undo?: () => void; locked: boolean;
  geo: Geo; pnl: DesignPnl; address: string; acres: number; ms: number;
}) {
  const uid = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tool, setTool] = useState<Tool>("hand");
  const [hover, setHover] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const [x0, y0, x1, y1] = geo.ground.r;
  const pad = Math.max(x1 - x0, y1 - y0) * 0.08;
  const full = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
  const [view, setView] = useState(full);
  useEffect(() => { setView(full); /* a new tract */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x0, y0, x1, y1]);
  const drag = useRef<{ kind: "pan" | "move" | "rot"; sx: number; sy: number; v: typeof view; d: PlatDesign } | null>(null);
  // metres a screen pixel, so a hairline is a hairline at any zoom
  const [box, setBox] = useState<[number, number]>([640, 480]);
  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setBox([el.clientWidth || 640, el.clientHeight || 480]));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const mpp = Math.max(view.w / box[0], view.h / box[1]);
  const toUser = (cx: number, cy: number): [number, number] => {
    const svg = svgRef.current;
    if (!svg) return [0, 0];
    const pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy;
    const m = svg.getScreenCTM();
    if (!m) return [0, 0];
    const q = pt.matrixTransform(m.inverse());
    return [q.x, q.y];
  };
  const C = geo.frame.C, u = geo.frame.u;
  const handleR = Math.min(x1 - x0, y1 - y0) * 0.32;
  const handle: [number, number] = [C[0] + u[0] * handleR, C[1] + u[1] * handleR];
  const B = geo.base;
  // which lot carries which number, and its premium (the engine's lotPremium on the geometry's distances)
  const kinds = design.amen.map((a) => a.k);
  const allShare = [...new Set(kinds)].reduce((t, k) => t + AMENITIES[k].all, 0);
  const lotOfBase = new Map<number, number>();
  geo.lots.forEach((l, i) => { for (const b of l.base ?? []) if (!lotOfBase.has(b)) lotOfBase.set(b, i); });
  const claimedBy = new Map<number, string>();
  geo.pond.lots.forEach((i) => claimedBy.set(i, "pond"));
  geo.amen.forEach((a, k) => a.lots.forEach((i) => claimedBy.set(i, `a${k}`)));
  for (const i of geo.open) claimedBy.set(i, "open");

  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    const [x, y] = toUser(e.clientX, e.clientY);
    const onHandle = Math.hypot(x - handle[0], y - handle[1]) < 14 * mpp;
    if (!locked && tool === "move" && onHandle) drag.current = { kind: "rot", sx: x, sy: y, v: view, d: design };
    else if (!locked && tool === "move") drag.current = { kind: "move", sx: x, sy: y, v: view, d: design };
    else if (tool === "hand") drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, v: view, d: design };
    else { click(x, y); return; }
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const raf = useRef(0);
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    setTip({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });
    if (!d) return;
    if (d.kind === "pan") {
      const k = d.v.w / (svgRef.current?.clientWidth || 640);
      setView({ ...d.v, x: d.v.x - (e.clientX - d.sx) * k, y: d.v.y - (e.clientY - d.sy) * k });
      return;
    }
    const [x, y] = toUser(e.clientX, e.clientY);
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      if (d.kind === "move") {
        const snap = (v: number) => Math.round(v / 5) * 5;
        setDesign({ ...d.d, shift: [snap(d.d.shift[0] + x - d.sx), snap(d.d.shift[1] + y - d.sy)], open: [], merge: [], split: [] }, false);
      } else {
        const a0 = Math.atan2(d.sy - C[1], d.sx - C[0]), a1 = Math.atan2(y - C[1], x - C[0]);
        let r = d.d.rot + ((a1 - a0) * 180) / Math.PI;
        r = ((r + 540) % 360) - 180;
        r = Math.round(r);
        for (const sq of [-90, 0, 90, 180, -180]) if (Math.abs(r - sq) <= 3) r = sq;
        setDesign({ ...d.d, rot: r, open: [], merge: [], split: [] }, false);
      }
    });
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && d.kind !== "pan" && JSON.stringify(d.d) !== JSON.stringify(design)) remember(d.d);
  };
  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const [x, y] = toUser(e.clientX, e.clientY);
    const k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    const w = Math.min(full.w * 1.2, Math.max(60, view.w * k)), h = (w / view.w) * view.h;
    setView({ x: x - ((x - view.x) * w) / view.w, y: y - ((y - view.y) * h) / view.h, w, h });
  };
  // which base lot is under a point
  const baseAt = (x: number, y: number): number => {
    for (let i = 0; i < B.length; i++) if (inRing([x, y], B[i].ring)) return i;
    return -1;
  };
  const toggle = (arr: number[], i: number) => (arr.includes(i) ? arr.filter((x) => x !== i) : [...arr, i]);
  const click = (x: number, y: number) => {
    if (locked) return;
    if (tool === "pond") { setDesign({ ...design, pond: [x, y] }); return; }
    if (AMENITY_KINDS.includes(tool as AmenityKind)) {
      const k = tool as AmenityKind;
      if (k === "greenway") {
        if (!design.amen.some((a) => a.k === "greenway")) setDesign({ ...design, amen: [...design.amen, { k, at: null }] });
        return;
      }
      setDesign({ ...design, amen: [...design.amen, { k, at: [x, y] }] });
      return;
    }
    const i = baseAt(x, y);
    if (i < 0) return;
    if (tool === "open") setDesign({ ...design, open: toggle(design.open, i) });
    else if (tool === "merge") setDesign({ ...design, merge: toggle(design.merge, i) });
    else if (tool === "split") { if (canSplit(B[i]) || design.split.includes(i)) setDesign({ ...design, split: toggle(design.split, i) }); }
  };

  const showNums = (65 * FT) / mpp > 11;
  const hov = hover !== null ? geo.lots[hover] : null;
  const hovPrem = hov ? lotPremium(hov.near, kinds) : 0;
  const ringD = (r: [number, number][]) => "M" + r.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join("L") + "Z";
  const lineD = (r: [number, number][]) => "M" + r.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join("L");
  // scale bar: a round length about 110 px long
  const sbFt = [50, 100, 200, 250, 500, 1000, 2000].find((f) => (f * FT) / mpp >= 90) ?? 2000;
  const sbM = sbFt * FT;
  const nAng = (Math.atan2(geo.ground.north[1], geo.ground.north[0]) * 180) / Math.PI + 90;
  const amenSummary = geo.amen.map((a, k) => ({
    k, kind: a.k, ok: a.ok, ac: a.sf / 43560, lots: a.lots.length,
    lifted: geo.lots.filter((l) => l.near.some(([j, m]) => j === k && AMENITIES[a.k].adj * Math.exp(-(m / FT) / AMENITIES[a.k].decayFt) >= 0.005)).length,
    cost: pnl.amenity[k]?.cost ?? 0,
  }));
  return (
    <div className="dev-design land-design">
      <div className="plat-wrap">
        <div className="plat-tools" role="toolbar" aria-label="Plat tools">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" title={t.title} disabled={locked && t.id !== "hand"} className={"btn-mini" + (tool === t.id ? " on" : "")} onClick={() => setTool(t.id)}>{t.label}</button>
          ))}
          {undo && <button type="button" className="btn-mini" onClick={undo} title="Undo the last change">Undo</button>}
          <button type="button" className="btn-mini" onClick={() => setView(full)} title="Fit the tract">Fit</button>
          <span className="plat-ms mono dim" title="Time to redraw and reprice the plat">{ms.toFixed(0)} ms</span>
        </div>
        <svg ref={svgRef} className={"plat-map tool-" + tool} viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} preserveAspectRatio="xMidYMid meet"
          style={{ aspectRatio: `${full.w} / ${full.h}` }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => { setHover(null); setTip(null); }} onWheel={onWheel}
          role="img" aria-label={`Plat of ${address}`}>
          <defs>
            <pattern id={`fp${uid}`} patternUnits="userSpaceOnUse" width={6 * mpp} height={6 * mpp} patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2={6 * mpp} className="plat-hatch" strokeWidth={0.8 * mpp} />
            </pattern>
            <pattern id={`os${uid}`} patternUnits="userSpaceOnUse" width={4 * mpp} height={4 * mpp}>
              <circle cx={2 * mpp} cy={2 * mpp} r={0.6 * mpp} className="plat-dot" />
            </pattern>
            {geo.streets.map((s, i) => <path key={i} id={`st${uid}${i}`} d={lineD(s.pl[0][0] <= s.pl.at(-1)![0] ? s.pl : [...s.pl].reverse())} />)}
          </defs>
          <rect x={view.x - view.w} y={view.y - view.h} width={view.w * 3} height={view.h * 3} className="plat-paper" />
          {geo.ground.flood.map((r, i) => <path key={i} d={ringD(r)} fill={`url(#fp${uid})`} className="plat-flood" />)}
          <path d={ringD(geo.ground.outline)} className="plat-boundary" strokeWidth={1.6 * mpp} />
          {/* streets: the right-of-way as two thin lines, a dashed centreline */}
          {geo.streets.map((s, i) => <path key={`o${i}`} d={lineD(s.pl)} className="plat-row-edge" strokeWidth={s.row * FT + 1.4 * mpp} />)}
          {geo.bulbs.map((b, i) => <circle key={`bo${i}`} cx={b.c[0]} cy={b.c[1]} r={55 * FT + 0.7 * mpp} className="plat-row-edge-fill" />)}
          {geo.streets.map((s, i) => <path key={`i${i}`} d={lineD(s.pl)} className="plat-row" strokeWidth={s.row * FT} />)}
          {geo.bulbs.map((b, i) => <circle key={`bi${i}`} cx={b.c[0]} cy={b.c[1]} r={55 * FT} className="plat-row-fill" />)}
          {geo.streets.map((s, i) => <path key={`c${i}`} d={lineD(s.pl)} className="plat-cl" strokeWidth={0.5 * mpp} strokeDasharray={`${6 * mpp} ${3 * mpp}`} />)}
          {/* claimed land: the pond's, the amenities', open space */}
          {B.map((l, i) => {
            const c = claimedBy.get(i);
            if (!c) return null;
            const cls = c === "pond" ? "plat-pondland" : c === "open" ? "plat-open" : "plat-park";
            return <path key={`cl${i}`} d={ringD(l.ring)} className={cls} fill={c === "open" ? `url(#os${uid})` : undefined} strokeWidth={0.6 * mpp} />;
          })}
          {geo.pond.lots.length > 0 && <circle cx={geo.pond.c[0]} cy={geo.pond.c[1]} r={geo.pond.r} className="plat-pond" strokeWidth={0.8 * mpp} />}
          {geo.amen.filter((a) => a.k === "greenway").flatMap((a) => a.trail ?? []).map((t, i) => (
            <path key={`tr${i}`} d={lineD(t)} className="plat-trail" strokeWidth={1.6 * mpp} strokeDasharray={`${4 * mpp} ${2.5 * mpp}`} />
          ))}
          {/* the lots */}
          {geo.lots.map((l, i) => {
            // tinted by what the lot earns from the parks beside it (the community-wide share is on every lot)
            const p = Math.max(0, (pnl.prem[i] ?? 0) - allShare);
            const merged = (l.base?.length ?? 1) > 1, half = !!l.half;
            return (
              <path key={`l${i}`} d={ringD(l.ring)}
                className={"plat-lot" + (hover === i ? " hov" : "") + (merged ? " merged" : "") + (half ? " half" : "")}
                style={p > 0.002 ? { fillOpacity: Math.min(0.5, p * 4.5) } : undefined}
                data-prem={p > 0.002 ? 1 : 0}
                strokeWidth={(hover === i ? 1.4 : 0.55) * mpp}
                onPointerEnter={() => setHover(i)} />
            );
          })}
          {showNums && geo.lots.map((l, i) => (
            <text key={`n${i}`} x={l.c[0]} y={l.c[1]} className="plat-num" fontSize={Math.min(9 * mpp, 7)} dominantBaseline="middle" textAnchor="middle">{i + 1}</text>
          ))}
          {/* street names, along the street */}
          {geo.streets.map((s, i) => {
            const L = s.pl.reduce((t, p, j) => (j ? t + Math.hypot(p[0] - s.pl[j - 1][0], p[1] - s.pl[j - 1][1]) : 0), 0);
            const fs = Math.min(s.row * FT * 0.42, 8.5 * mpp);
            if (L < fs * s.name.length * 0.75) return null;
            return (
              <text key={`sn${i}`} className="plat-street" fontSize={fs} dominantBaseline="middle">
                <textPath href={`#st${uid}${i}`} startOffset="50%" textAnchor="middle">{s.name.toUpperCase()}</textPath>
              </text>
            );
          })}
          {/* amenity labels */}
          {geo.amen.map((a, k) => {
            if (!a.lots.length) return null;
            const c = a.lots.reduce((t, i) => [t[0] + B[i].c[0] / a.lots.length, t[1] + B[i].c[1] / a.lots.length], [0, 0]);
            return <text key={`al${k}`} x={c[0]} y={c[1]} className="plat-amen-label" fontSize={9 * mpp} textAnchor="middle" dominantBaseline="middle">{SHORT[a.k]} · {(a.sf / 43560).toFixed(2)} AC</text>;
          })}
          {geo.pond.lots.length > 0 && <text x={geo.pond.c[0]} y={geo.pond.c[1]} className="plat-pond-label" fontSize={8 * mpp} textAnchor="middle" dominantBaseline="middle">DETENTION</text>}
          {geo.ground.flood.length > 0 && (() => {
            const r = geo.ground.flood.reduce((b, x) => (Math.abs((x[2][0] - x[0][0]) * (x[2][1] - x[0][1])) > Math.abs((b[2][0] - b[0][0]) * (b[2][1] - b[0][1])) ? x : b));
            return <text x={(r[0][0] + r[2][0]) / 2} y={(r[0][1] + r[2][1]) / 2} className="plat-flood-label" fontSize={9 * mpp} textAnchor="middle">FLOODPLAIN</text>;
          })()}
          {/* the hovered lot's frontage, dimensioned */}
          {hov && (() => {
            const [a, b] = hov.front;
            const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
            const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
            const up = ang > 90 || ang < -90 ? ang + 180 : ang;
            return (
              <g className="plat-dim">
                <path d={lineD([a, b])} strokeWidth={1.2 * mpp} />
                <circle cx={a[0]} cy={a[1]} r={1.6 * mpp} /><circle cx={b[0]} cy={b[1]} r={1.6 * mpp} />
                <text x={mx} y={my} fontSize={8 * mpp} textAnchor="middle" dy={-3 * mpp} transform={`rotate(${up} ${mx} ${my})`}>{Math.round(hov.w)}′</text>
              </g>
            );
          })()}
          {/* the turn handle */}
          {!locked && tool === "move" && (
            <g className="plat-handle">
              <path d={lineD([C, handle])} strokeWidth={0.8 * mpp} strokeDasharray={`${3 * mpp} ${2 * mpp}`} />
              <circle cx={handle[0]} cy={handle[1]} r={7 * mpp} strokeWidth={1.2 * mpp} />
              <text x={handle[0]} y={handle[1] - 11 * mpp} fontSize={9 * mpp} textAnchor="middle">{design.rot}°</text>
            </g>
          )}
          {/* north arrow, scale bar, title block — in the view's corners */}
          <g transform={`translate(${view.x + view.w - 26 * mpp} ${view.y + 30 * mpp}) rotate(${nAng})`} className="plat-north">
            <path d={`M0 ${-16 * mpp} L${6 * mpp} ${8 * mpp} L0 ${3 * mpp} Z`} className="fill" />
            <path d={`M0 ${-16 * mpp} L${-6 * mpp} ${8 * mpp} L0 ${3 * mpp} Z`} strokeWidth={0.8 * mpp} />
            <text y={-20 * mpp} fontSize={10 * mpp} textAnchor="middle" transform={`rotate(${-nAng} 0 ${-20 * mpp})`}>N</text>
          </g>
          <g transform={`translate(${view.x + 14 * mpp} ${view.y + view.h - 16 * mpp})`} className="plat-scale">
            {[0, 1, 2, 3].map((q) => <rect key={q} x={(q * sbM) / 4} y={-3 * mpp} width={sbM / 4} height={3 * mpp} className={q % 2 ? "" : "fill"} strokeWidth={0.6 * mpp} />)}
            <text x={0} y={-6 * mpp} fontSize={8 * mpp}>0</text>
            <text x={sbM} y={-6 * mpp} fontSize={8 * mpp} textAnchor="middle">{sbFt} ft</text>
          </g>
          <g transform={`translate(${view.x + view.w - 10 * mpp} ${view.y + view.h - 10 * mpp})`} className="plat-title">
            <text fontSize={9 * mpp} textAnchor="end" y={-12 * mpp}>{locked ? "PLAT ON FILE" : "PRELIMINARY PLAT"} · {address.replace(/ \(.*\)$/, "").toUpperCase()}</text>
            <text fontSize={8 * mpp} textAnchor="end">{geo.lots.length} LOTS · {acres.toFixed(1)} AC · {pnl.density.gross.toFixed(2)} DU/AC GROSS</text>
          </g>
        </svg>
        {hov && tip && (
          <div className="plat-tip mono" style={{ left: tip.x + 14, top: tip.y + 10 }}>
            <b>Lot {hover! + 1}</b> · {hov.a.toLocaleString()} sf · {Math.round(hov.w)}×{Math.round(hov.d)} ft{hov.pie ? " pie" : ""}<br />
            {hovPrem > 0 ? `+${P1(hovPrem)} house price` : "no premium"} · bid {M(pnl.resid[hover!] ?? 0)}
          </div>
        )}
      </div>
      <div className="plat-side">
        <div className="page-section-head">Amenities</div>
        <div className="plat-palette">
          {AMENITY_KINDS.map((k) => {
            const f = AMENITIES[k];
            return (
              <button key={k} type="button" disabled={locked} className={"btn-mini" + (tool === k ? " on" : "")} onClick={() => setTool(k)}
                title={`${f.name}: ${f.acres ? `${f.acres} ac` : "runs on the floodplain's edge"}, ${f.perFt ? `$${f.perFt}/ft of trail` : M(f.cost)}; ${f.all ? `+${P1(f.all)} on every house` : `+${P1(f.adj)} beside it, fading over ~${f.decayFt} ft`}. ${f.src}`}>
                {f.name}
              </button>
            );
          })}
        </div>
        {amenSummary.length > 0 ? (
          <table className="tbl plat-amen">
            <thead><tr><th>Placed</th><th className="num">ac</th><th className="num">lots</th><th className="num">lifted</th><th className="num">cost</th><th /></tr></thead>
            <tbody>
              {amenSummary.map((a) => (
                <tr key={a.k} style={{ cursor: "default" }}>
                  <td>{AMENITIES[a.kind].name}{!a.ok && <span className="neg"> · no room</span>}</td>
                  <td className="num">{a.ac.toFixed(2)}</td>
                  <td className="num">{a.lots ? `−${a.lots}` : "—"}</td>
                  <td className="num">{AMENITIES[a.kind].all ? "all" : a.lifted}</td>
                  <td className="num">{M(a.cost)}</td>
                  <td>{!locked && <button type="button" className="btn-mini" onClick={() => setDesign({ ...design, amen: design.amen.filter((_x, j) => j !== a.k) })}>×</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="hint">Pick one and click the plat. Lots fronting or backing onto a park sell a dearer house; the land it takes is lots you do not sell.</div>}
        <div className="grid" style={{ marginTop: 8 }}>
          <Row k="Premium lots" v={`${pnl.premLots} of ${pnl.lots} · avg +${P1(pnl.premAvg)}`} />
          <Row k="From premiums" v={`${M(pnl.revenue - pnl.revenueStd)} of lot sales`} />
          <Row k="Edits" v={`${design.merge.length} merged · ${design.split.length} split · ${design.open.length} open`} />
        </div>
        {(design.merge.length + design.split.length + design.open.length) > 0 && !locked && (
          <button type="button" className="btn-mini" onClick={() => setDesign({ ...design, merge: [], split: [], open: [] })}>Clear lot edits</button>
        )}
        <div className="hint" style={{ marginTop: 6 }}>Turn: {design.rot}° · slide: {design.shift[0]}, {design.shift[1]} m · {geo.layout}</div>
      </div>
    </div>
  );
}

function inRing(p: [number, number], ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
