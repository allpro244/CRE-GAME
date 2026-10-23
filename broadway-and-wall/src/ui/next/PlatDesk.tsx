/**
 * THE LAND DESK, SIMPLE (owner, Oct 2026): a farm tract you own, laid out as
 * a subdivision with four choices and one commit —
 *
 *   Lots     the lot size (5,000 to 15,000 sf)
 *   Streets  the pattern: grid, loops, cul-de-sacs
 *   Parks    a few toggles; the geometry sets each where it serves most lots
 *   Loan     the A&D loan or none, terms shown
 *
 * and the plat itself, drawn as a plat is drawn (numbered lots, named
 * streets, the floodplain hatched), redrawn on every choice. The numbers are
 * the engine's (platScheme.ts → designPnl, adQuote, entitleQuote).
 */
import { useId, useState } from "react";
import { useStore } from "@/state/store";
import { useHeldGame } from "@/ui/heldGame";
import { monthLabel, type PlatDesign, type AmenityKind } from "@/engine/types";
import { AMENITIES, DESIGN_LOT_SIZES, lotPremium, type DesignPnl } from "@/engine/platdesign";
import { usd } from "@/ui/format";
import { platScheme, platCommit, setPlatDraft, usePlatDrafts, PLAT_AMENITIES, type PlatScheme } from "./platScheme";
import "./desks.css";

const LAYOUTS: { id: PlatDesign["layout"]; label: string }[] = [{ id: "grid", label: "Grid" }, { id: "loops", label: "Loops" }, { id: "culdesac", label: "Cul-de-sacs" }];
const SHORT_NAME: Partial<Record<AmenityKind, string>> = { park: "Park", greenway: "Greenway", pool: "Pool & club", entry: "Entry" };
const FT = 0.3048;
const M = (n: number) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1000).toLocaleString()}K`);
const P1 = (x: number) => `${(x * 100).toFixed(1)}%`;
const irrText = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);

function Chip({ on, onClick, children, title, disabled }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string; disabled?: boolean }) {
  return <button type="button" className={"bd-chip" + (on ? " on" : "")} onClick={onClick} title={title} disabled={disabled} aria-pressed={on}>{children}</button>;
}
function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="bd-row"><div className="bd-k">{k}</div><div className="bd-v">{children}</div></div>;
}

export default function PlatDesk({ bbl, commit = false }: { bbl: string; commit?: boolean }) {
  const game = useHeldGame(bbl);
  usePlatDrafts();
  const parcels = useStore((s) => s.parcels)!;
  const s = platScheme(game, parcels, bbl);
  const { rec, design, pnl, ad, geo, locked } = s;
  if (!rec?.ag || !rec.tract || !geo || !pnl) return null;
  if (!s.developable) {
    return (
      <div className="deal land-desk">
        <div className="bd-verdict bad"><div className="bd-note">{`${(rec.lotArea / 43560).toFixed(0)} ac · ${pnl.density.buildableAc.toFixed(1)} buildable · no plat fits`}</div></div>
      </div>
    );
  }
  // a new size or pattern changes every lot, so hand edits on the old one go
  const set = (p: Partial<PlatDesign>, lev = s.lev) => { if (!locked) setPlatDraft(game.seed, bbl, { design: { ...design, ...p }, lev }); };
  const reframe = (p: Partial<PlatDesign>) => set({ ...p, open: [], merge: [], split: [] });
  const size = (() => { const ks = Object.keys(design.mix).filter((k) => (design.mix[Number(k) as keyof typeof design.mix] ?? 0) > 0); return ks.length === 1 ? Number(ks[0]) : null; })();
  const has = (k: AmenityKind) => design.amen.some((a) => a.k === k);
  const toggle = (k: AmenityKind) => {
    if (has(k)) { set({ amen: design.amen.filter((a) => a.k !== k) }); return; }
    set({ amen: [...design.amen, { k, at: amenitySpot(k, geo) }] });
  };
  const status = s.plat ? (s.plat.done ? "Platted" : `Streets · done ${monthLabel(s.plat.doneM)}`)
    : s.app ? `Board · ${monthLabel(s.app.decideM)} · ${Math.round(s.app.odds * 100)}%`
    : s.rz ? `Rezoned ${s.rz.zone}${s.rz.lots ? ` · ${s.rz.lots} lots` : ""}` : "Zoned AG";

  return (
    <div className="deal land-desk">
      <Verdict pnl={pnl} s={s} />
      <div className="bd-grid">
        <div className="bd-model">
          <PlatPicture geo={geo} pnl={pnl} design={design} address={rec.address} acres={rec.lotArea / 43560} locked={locked} />
        </div>
        <div className="bd-choices">
          <div className="bd-terms" style={{ paddingLeft: 0 }}>{status} · {(rec.lotArea / 43560).toFixed(0)} ac · {pnl.density.buildableAc.toFixed(1)} buildable · house {M(pnl.house.price)}</div>
          <Row k="Lots">
            {DESIGN_LOT_SIZES.map((sz) => (
              <Chip key={sz} on={size === sz} disabled={locked} onClick={() => reframe({ mix: { [sz]: 1 } })}>{sz / 1000}K sf</Chip>
            ))}
            {size === null && <Chip on disabled onClick={() => {}}>Mixed</Chip>}
          </Row>
          <Row k="Streets">
            {LAYOUTS.map((l) => (
              <Chip key={l.id} on={design.layout === l.id} disabled={locked} onClick={() => reframe({ layout: l.id })}>{l.label}</Chip>
            ))}
          </Row>
          <Row k="Parks">
            {PLAT_AMENITIES.map((k) => {
              const f = AMENITIES[k];
              const cost = pnl.amenity[design.amen.findIndex((a) => a.k === k)]?.cost;
              return (
                <Chip key={k} on={has(k)} disabled={locked} onClick={() => toggle(k)}
                  title={`${f.name} · ${f.perFt ? `$${f.perFt}/ft of trail` : M(f.cost)} · ${f.all ? `+${P1(f.all)} every house` : `+${P1(f.adj)} beside it`}`}>
                  {SHORT_NAME[k]}{has(k) && cost !== undefined && <span className="bd-sub"> {M(cost)}</span>}
                </Chip>
              );
            })}
          </Row>
          {design.amen.some((a) => !PLAT_AMENITIES.includes(a.k)) && (
            <div className="bd-terms">Also: {design.amen.filter((a) => !PLAT_AMENITIES.includes(a.k)).map((a) => AMENITIES[a.k].name).join(", ")}</div>
          )}
          {ad && (
            <>
              <Row k="Loan">
                <Chip on={s.lev === 0} disabled={locked && !s.rz} onClick={() => set({}, 0)}>None</Chip>
                <Chip on={s.lev > 0} disabled={(locked && !s.rz) || !(ad.ltcMax > 0)} onClick={() => set({}, 1)}>A&amp;D loan</Chip>
              </Row>
              <div className="bd-terms mono">{ad.ltcMax > 0
                ? `${ad.lender} · ${ad.ratePct.toFixed(2)}% · ${P1(ad.ltcMax)} LTC${ad.loan > 0 ? ` · ${M(ad.loan)}` : ""} · ${ad.termM} mo`
                : ad.why ?? "No lender quotes"}</div>
            </>
          )}
          <Details pnl={pnl} s={s} />
          {commit && <PlatCommitButton s={s} bbl={bbl} />}
        </div>
      </div>
    </div>
  );
}

/**
 * WHERE A TOGGLED AMENITY GOES: a park or a pool at the middle of the plat,
 * where the most lots are near it; an entry at the plat's first street, where
 * it meets the road. The geometry claims the lots nearest that point.
 */
function amenitySpot(k: AmenityKind, geo: NonNullable<PlatScheme["geo"]>): [number, number] | null {
  if (k === "greenway") return null;
  const B = geo.base;
  if (!B.length) return null;
  const c = B.reduce((t, l) => [t[0] + l.c[0] / B.length, t[1] + l.c[1] / B.length], [0, 0]);
  const toward = k === "entry" && geo.streets[0]?.pl[0] ? geo.streets[0].pl[0] : c;
  let best = B[0].c, d = Infinity;
  for (const l of B) { const e = Math.hypot(l.c[0] - toward[0], l.c[1] - toward[1]); if (e < d) { d = e; best = l.c; } }
  return [best[0], best[1]];
}

function Verdict({ pnl, s }: { pnl: DesignPnl; s: PlatScheme }) {
  const lev = !!s.ad && s.lev > 0 && s.ad.loan > 0;
  const irr = lev ? s.ad!.irr : pnl.irr;
  const tone = pnl.profit > 0 && (pnl.irr ?? 0) > 0.15 ? "good" : pnl.profit > 0 ? "warn" : "bad";
  return (
    <div className={"bd-verdict " + tone}>
      <div className="bd-cell"><div className="bd-lab">Profit</div><div className="bd-big mono">{pnl.profit < 0 ? "−" : ""}{M(Math.abs(pnl.profit))}</div></div>
      <div className="bd-cell"><div className="bd-lab">{lev ? "IRR · levered" : "IRR"}</div><div className="bd-mid mono">{irrText(irr)}</div></div>
      <div className="bd-cell"><div className="bd-lab">Lots</div><div className="bd-mid mono">{pnl.lots} · {M(pnl.revenue / Math.max(1, pnl.lots))}</div></div>
      <div className="bd-cell"><div className="bd-lab">Equity</div><div className="bd-mid mono">{s.ad ? M(s.ad.equityAll) : "—"}</div></div>
      {pnl.revenue <= 0 && <div className="bd-note">No lot bids</div>}
    </div>
  );
}

/** One disclosure for the P&L lines behind the verdict. */
function Details({ pnl, s }: { pnl: DesignPnl; s: PlatScheme }) {
  const rows: [string, string][] = [
    ["Land", M(pnl.land)],
    ["Rezoning", pnl.entitleSpent ? "spent" : M(pnl.entitle)],
    ["Streets", M(pnl.streets)],
    ["Impact fees", M(pnl.impact)],
    ["Amenities", M(pnl.amenTotal)],
    ["Lot sales", M(pnl.revenue)],
    ["Margin", Number.isFinite(pnl.margin) ? P1(pnl.margin) : "—"],
    ["Sell-out", `${Number.isFinite(pnl.selloutM) ? pnl.selloutM : "—"} mo · ${pnl.pace.toFixed(1)}/mo`],
    ["Density", `${pnl.density.gross.toFixed(2)} du/ac`],
    ...(s.ad ? [["At the streets", M(s.ad.equityNow)] as [string, string]] : []),
    ...(s.eq ? [["Board", `${s.eq.months} mo · ${Math.round(s.eq.odds * 100)}% · ${usd(s.eq.cost)}`] as [string, string]] : []),
  ];
  return (
    <details className="bd-details">
      <summary>Numbers</summary>
      <table className="bd-kv"><tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td className="mono">{v}</td></tr>)}</tbody></table>
    </details>
  );
}

/** The one commit: file the rezoning with this plat, or build its streets. */
export function platVerb(s: PlatScheme): string | null {
  return s.step === "rezone" ? `Rezone · ${s.eq ? usd(s.eq.cost) : "—"}` : s.step === "streets" ? `Build streets · ${s.ad ? M(s.ad.equityNow) : "—"}` : null;
}
function PlatCommitButton({ s, bbl }: { s: PlatScheme; bbl: string }) {
  const verb = platVerb(s);
  if (!verb) return <div className="bd-terms">{s.step === "board" ? "Before the board" : s.step === "done" ? "Platted" : s.step === "building" ? "Streets going in" : "Buy the tract"}</div>;
  return (
    <button type="button" className="btn btn-buy bd-commit" disabled={!!s.why} title={s.why ?? undefined} onClick={() => platCommit(s, bbl, useStore.getState())}>
      {s.why ?? verb}
    </button>
  );
}

// ---------------------------------------------------------------- the plat, read-only
type Geo = NonNullable<PlatScheme["geo"]>;
function PlatPicture({ geo, pnl, design, address, acres, locked }: { geo: Geo; pnl: DesignPnl; design: PlatDesign; address: string; acres: number; locked: boolean }) {
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const [x0, y0, x1, y1] = geo.ground.r;
  const pad = Math.max(x1 - x0, y1 - y0) * 0.06;
  const view = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
  // metres a pixel at the picture's ~560 px width, so a hairline is a hairline
  const mpp = view.w / 560;
  const B = geo.base;
  const kinds = design.amen.map((a) => a.k);
  const allShare = [...new Set(kinds)].reduce((t, k) => t + AMENITIES[k].all, 0);
  const claimedBy = new Map<number, string>();
  geo.pond.lots.forEach((i) => claimedBy.set(i, "pond"));
  geo.amen.forEach((a, k) => a.lots.forEach((i) => claimedBy.set(i, `a${k}`)));
  for (const i of geo.open) claimedBy.set(i, "open");
  const ringD = (r: [number, number][]) => "M" + r.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join("L") + "Z";
  const lineD = (r: [number, number][]) => "M" + r.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join("L");
  const nAng = (Math.atan2(geo.ground.north[1], geo.ground.north[0]) * 180) / Math.PI + 90;
  const sbFt = [50, 100, 200, 250, 500, 1000, 2000].find((f) => (f * FT) / mpp >= 90) ?? 2000;
  const sbM = sbFt * FT;
  const hov = hover !== null ? geo.lots[hover] : null;
  const showNums = (65 * FT) / mpp > 11;
  return (
    <div className="plat-wrap" style={{ position: "relative" }}>
      <svg className="plat-map" viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} preserveAspectRatio="xMidYMid meet"
        style={{ aspectRatio: `${view.w} / ${view.h}` }} onPointerLeave={() => setHover(null)} role="img" aria-label={`Plat of ${address}`}>
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
        {geo.streets.map((s, i) => <path key={`o${i}`} d={lineD(s.pl)} className="plat-row-edge" strokeWidth={s.row * FT + 1.4 * mpp} />)}
        {geo.bulbs.map((b, i) => <circle key={`bo${i}`} cx={b.c[0]} cy={b.c[1]} r={55 * FT + 0.7 * mpp} className="plat-row-edge-fill" />)}
        {geo.streets.map((s, i) => <path key={`i${i}`} d={lineD(s.pl)} className="plat-row" strokeWidth={s.row * FT} />)}
        {geo.bulbs.map((b, i) => <circle key={`bi${i}`} cx={b.c[0]} cy={b.c[1]} r={55 * FT} className="plat-row-fill" />)}
        {geo.streets.map((s, i) => <path key={`c${i}`} d={lineD(s.pl)} className="plat-cl" strokeWidth={0.5 * mpp} strokeDasharray={`${6 * mpp} ${3 * mpp}`} />)}
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
        {geo.lots.map((l, i) => {
          const p = Math.max(0, (pnl.prem[i] ?? 0) - allShare);
          return (
            <path key={`l${i}`} d={ringD(l.ring)} className={"plat-lot" + (hover === i ? " hov" : "")}
              style={p > 0.002 ? { fillOpacity: Math.min(0.5, p * 4.5) } : undefined} data-prem={p > 0.002 ? 1 : 0}
              strokeWidth={(hover === i ? 1.4 : 0.55) * mpp} onPointerEnter={() => setHover(i)} />
          );
        })}
        {showNums && geo.lots.map((l, i) => (
          <text key={`n${i}`} x={l.c[0]} y={l.c[1]} className="plat-num" fontSize={Math.min(9 * mpp, 7)} dominantBaseline="middle" textAnchor="middle">{i + 1}</text>
        ))}
        {geo.streets.map((s, i) => {
          const L = s.pl.reduce((t, p, j) => (j ? t + Math.hypot(p[0] - s.pl[j - 1][0], p[1] - s.pl[j - 1][1]) : 0), 0);
          const fs = Math.min(s.row * FT * 0.42, 8.5 * mpp);
          if (L < fs * s.name.length * 0.75) return null;
          return <text key={`sn${i}`} className="plat-street" fontSize={fs} dominantBaseline="middle"><textPath href={`#st${uid}${i}`} startOffset="50%" textAnchor="middle">{s.name.toUpperCase()}</textPath></text>;
        })}
        {geo.amen.map((a, k) => {
          if (!a.lots.length) return null;
          const c = a.lots.reduce((t, i) => [t[0] + B[i].c[0] / a.lots.length, t[1] + B[i].c[1] / a.lots.length], [0, 0]);
          return <text key={`al${k}`} x={c[0]} y={c[1]} className="plat-amen-label" fontSize={9 * mpp} textAnchor="middle" dominantBaseline="middle">{(SHORT_NAME[a.k] ?? AMENITIES[a.k].name).toUpperCase()} · {(a.sf / 43560).toFixed(2)} AC</text>;
        })}
        {geo.pond.lots.length > 0 && <text x={geo.pond.c[0]} y={geo.pond.c[1]} className="plat-pond-label" fontSize={8 * mpp} textAnchor="middle" dominantBaseline="middle">DETENTION</text>}
        <g transform={`translate(${view.x + view.w - 26 * mpp} ${view.y + 30 * mpp}) rotate(${nAng})`} className="plat-north">
          <path d={`M0 ${-16 * mpp} L${6 * mpp} ${8 * mpp} L0 ${3 * mpp} Z`} className="fill" />
          <path d={`M0 ${-16 * mpp} L${-6 * mpp} ${8 * mpp} L0 ${3 * mpp} Z`} strokeWidth={0.8 * mpp} />
        </g>
        <g transform={`translate(${view.x + 14 * mpp} ${view.y + view.h - 16 * mpp})`} className="plat-scale">
          {[0, 1, 2, 3].map((q) => <rect key={q} x={(q * sbM) / 4} y={-3 * mpp} width={sbM / 4} height={3 * mpp} className={q % 2 ? "" : "fill"} strokeWidth={0.6 * mpp} />)}
          <text x={0} y={-6 * mpp} fontSize={8 * mpp}>0</text>
          <text x={sbM} y={-6 * mpp} fontSize={8 * mpp} textAnchor="middle">{sbFt} ft</text>
        </g>
        <g transform={`translate(${view.x + view.w - 10 * mpp} ${view.y + view.h - 10 * mpp})`} className="plat-title">
          <text fontSize={9 * mpp} textAnchor="end" y={-12 * mpp}>{locked ? "PLAT ON FILE" : "PRELIMINARY PLAT"} · {address.replace(/ \(.*\)$/, "").toUpperCase()}</text>
          <text fontSize={8 * mpp} textAnchor="end">{geo.lots.length} LOTS · {acres.toFixed(1)} AC · {pnl.density.gross.toFixed(2)} DU/AC</text>
        </g>
      </svg>
      {hov && (
        <div className="plat-tip mono" style={{ left: 8, top: 8 }}>
          <b>Lot {hover! + 1}</b> · {hov.a.toLocaleString()} sf · {Math.round(hov.w)}×{Math.round(hov.d)} ft<br />
          {lotPremium(hov.near, kinds) > 0 ? `+${P1(lotPremium(hov.near, kinds))}` : "no premium"} · bid {M(pnl.resid[hover!] ?? 0)}
        </div>
      )}
    </div>
  );
}
