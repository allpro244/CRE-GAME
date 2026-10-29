// THE INDUSTRIES AND WHO BUYS FROM WHOM (ONE_ECONOMY_PLAN step 9a).
//
// Markets → Industries: every industry in the town's firm books (economy.ts),
// grouped into about twenty tenant types (industries.ts `type`; open a type to
// see its industries) — jobs, sales a year, the share sold out of town, margin,
// the last twelve months, its firms and yours. Pick one and its supply chain
// opens below: what it buys and from whom, what it sells and to whom, in
// dollars from the IO table on last month's output, with your tenants in it.
// Numbers first. Reads only.
import { useState } from "react";
import { useStore } from "@/state/store";
import { economyByIndustry } from "@/engine/economy";
import { INDUSTRIES, INDUSTRY_IDS, INDUSTRY_INDEX, TENANT_TYPES, type IndustryId } from "@/engine/industries";
import type { Holding } from "@/engine/types";
import { usd, sf, pctSigned } from "@/ui/format";
import { BizLink, Spark, goIndustry } from "@/ui/BizSheet";
import {
  bizPlaces, industryFirms, industryTrend, rentExposure, shortInd, supplyChain, yourTenantsByIndustry, type Flow,
} from "@/ui/econView";
import "@/ui/biz.css";

const k = (v: number) => (v >= 1e4 ? `${Math.round(v / 1000)}k` : Math.round(v).toLocaleString());

export function Industries() {
  const game = useStore((s) => s.game)!;
  const focus = useStore((s) => s.industryFocus) as IndustryId | null;
  const open = goIndustry;
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const rows = economyByIndustry(game);
  if (!rows) {
    return <div className="hint">The town's firm books open the month after its households are counted. Advance a month.</div>;
  }
  const yours = yourTenantsByIndustry(game);
  const jobs = rows.reduce((a, r) => a + r.heads, 0);
  const out = rows.reduce((a, r) => a + r.output, 0);
  const ex = rows.reduce((a, r) => a + r.exports, 0);
  const firms = rows.reduce((a, r) => a + r.firms, 0);
  return (
    <div>
      <div className="page-section">Industries · {k(jobs)} jobs · {usd(out * 12)} sales a year · {(ex / (out || 1) * 100).toFixed(0)}% sold out of town · {firms.toLocaleString()} firms</div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Industry</th><th className="num">Jobs</th><th className="num">Sales / yr</th><th className="num">Out of town</th>
            <th className="num">Margin</th><th>12 months</th><th className="num">Firms</th><th className="num">Your tenants</th>
          </tr>
        </thead>
        <tbody>
          {TENANT_TYPES.flatMap((g) => {
            const mine = rows.filter((r) => INDUSTRIES[r.id].type === g && (r.heads > 0 || r.output > 0));
            if (!mine.length) return [];
            const tOut = mine.reduce((a, r) => a + r.output, 0), tEx = mine.reduce((a, r) => a + r.exports, 0);
            const tYours = mine.reduce((a, r) => { const y = yours.get(r.id); return y ? { firms: a.firms + y.firms, sf: a.sf + y.sf } : a; }, { firms: 0, sf: 0 });
            const isOpen = !!shown[g] || mine.some((r) => r.id === focus);
            return [
            <tr key={`g-${g}`} className="ind-row" onClick={() => setShown({ ...shown, [g]: !isOpen })}>
              <td>{isOpen ? "▾" : "▸"} {g}{mine.length > 1 ? ` (${mine.length})` : ""}</td>
              <td className="num">{k(mine.reduce((a, r) => a + r.heads, 0))}</td>
              <td className="num">{usd(tOut * 12)}</td>
              <td className="num">{(tEx / (tOut || 1) * 100).toFixed(0)}%</td>
              <td></td><td></td>
              <td className="num">{mine.reduce((a, r) => a + r.firms, 0)}</td>
              <td className="num">{tYours.firms ? <span className="ind-yours">{tYours.firms} · {k(tYours.sf)} sf</span> : "—"}</td>
            </tr>,
            ...(!isOpen ? [] : mine.sort((a, b) => b.heads - a.heads).map((r) => {
              const tr = industryTrend(game, INDUSTRY_INDEX[r.id]);
              const chg = tr.x.length >= 2 && tr.x[0] > 0 ? tr.x[tr.x.length - 1] / tr.x[0] - 1 : null;
              const y = yours.get(r.id);
              return (
                <tr key={r.id} className={"ind-row" + (focus === r.id ? " on" : "")} onClick={() => open(focus === r.id ? null : r.id)}>
                  <td>{"\u00a0\u00a0\u00a0"}{r.label}</td>
                  <td className="num">{k(r.heads)}</td>
                  <td className="num">{usd(r.output * 12)}</td>
                  <td className="num">{(r.exportShare * 100).toFixed(0)}%</td>
                  <td className={"num" + (r.margin < 0 ? " neg" : "")}>{Number.isFinite(r.margin) ? (r.margin * 100).toFixed(1) + "%" : "—"}</td>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <Spark pts={tr.x} w={64} h={16} />
                      <span className={"mono" + (chg !== null && chg < 0 ? " neg" : "")} style={{ fontSize: 11 }}>{chg === null ? "" : pctSigned(chg)}</span>
                    </span>
                  </td>
                  <td className="num">{r.firms}</td>
                  <td className="num">{y ? <span className="ind-yours">{y.firms} · {k(y.sf)} sf</span> : "—"}</td>
                </tr>
              );
            })),
            ];
          })}
        </tbody>
      </table>
      <div className="hint">Click a type to see its industries, and an industry to see who it buys from and sells to. Sales are last month's at a yearly rate; margin is before interest.</div>
      {focus && INDUSTRY_IDS.includes(focus) && <SupplyChain id={focus} />}
    </div>
  );
}

function FlowList({ flows, total, out, max = 8 }: { flows: Flow[]; total: number; out?: boolean; max?: number }) {
  const open = goIndustry;
  const top = flows.slice(0, max);
  const big = top[0]?.v || 1;
  const rest = flows.slice(max).reduce((a, f) => a + f.v, 0);
  return (
    <div className="ind-flow">
      {top.map((f) => (
        <div key={f.key} style={{ display: "contents" }}>
          <div className="ind-flow-name" title={f.label}>
            <div className={"ind-flow-bar" + (out ? " out" : "")} style={{ width: `${(f.v / big) * 100}%` }} />
            <span>
              {f.ind ? <button type="button" className="biz-link" onClick={() => open(f.ind!)}>{f.label}</button> : f.label}
              {f.local !== undefined && f.v > 0 && <span className="dim"> · {(f.local / f.v * 100).toFixed(0)}% local</span>}
            </span>
          </div>
          <div className="ind-flow-v">{usd(f.v * 12)} <span className="dim">{(f.v / (total || 1) * 100).toFixed(0)}%</span></div>
        </div>
      ))}
      {rest > 0 && <>
        <div className="ind-flow-name dim"><span>{flows.length - max} more</span></div>
        <div className="ind-flow-v dim">{usd(rest * 12)}</div>
      </>}
    </div>
  );
}

function SupplyChain({ id }: { id: IndustryId }) {
  const game = useStore((s) => s.game)!;
  const i = INDUSTRY_INDEX[id];
  const sc = supplyChain(game, i);
  if (!sc) return null;
  const y = yourTenantsByIndustry(game).get(id);
  const { named, offMap } = industryFirms(game, i);
  const places = bizPlaces(game);
  const buyTot = sc.buys.reduce((a, f) => a + f.v, 0);
  const sellTot = sc.sells.reduce((a, f) => a + f.v, 0);
  const yourFirms = named.filter((f) => places.get(f.fid)?.own);
  const shown = [...yourFirms, ...named.filter((f) => !places.get(f.fid)?.own)].slice(0, 10);
  return (
    <div className="page-section" style={{ marginTop: 14 }}>
      <div className="page-section-head">
        {INDUSTRIES[id].label} · {usd(sc.output * 12)} sales a year
        {y && <span className="ind-yours"> · your tenants: {y.firms} firm{y.firms === 1 ? "" : "s"}, {k(y.sf)} sf, {usd(y.rentYr)} rent a year</span>}
      </div>
      <div className="ind-chain">
        <div>
          <div className="biz-lab">Buys from · {usd(buyTot * 12)} a year</div>
          <FlowList flows={sc.buys} total={buyTot} />
        </div>
        <div>
          <div className="biz-lab">Sells to · {usd(sellTot * 12)} a year</div>
          <FlowList flows={sc.sells} total={sellTot} out />
        </div>
      </div>
      <div className="biz-lab" style={{ marginTop: 12 }}>Firms · {named.length} named{offMap ? ` · ${offMap} off the map stand for the rest` : ""}</div>
      <table className="tbl">
        <thead><tr><th>Firm</th><th className="num">Sales / yr</th><th className="num">Jobs</th><th>Where</th></tr></thead>
        <tbody>
          {shown.map((f) => {
            const p = places.get(f.fid);
            return (
              <tr key={f.fid}>
                <td>{p ? <BizLink t={p.t} /> : `Firm ${f.fid}`}{p?.own && <span className="ind-yours"> · yours</span>}</td>
                <td className="num">{usd(f.rev * 12)}</td>
                <td className="num">{Math.round(f.heads).toLocaleString()}</td>
                <td className="dim">{p?.looking ? "looking for space" : p ? sf(p.t.sf) : ""}</td>
              </tr>
            );
          })}
          {!shown.length && <tr><td colSpan={4} className="dim">No firms on the map in this industry; off-map firms carry it.</td></tr>}
        </tbody>
      </table>
      <div className="hint">Dollar flows from the national input-output table on this town's output last month; "local" is the share bought from firms in town.</div>
    </div>
  );
}

/**
 * ONE LINE ON A PLAYER'S BUILDING: its rent by tenant industry, and whose
 * spending that rent rests on (§6e forward look) — "38% of rent rests on
 * households · 12% on Machinery".
 */
export function RentExposure({ holding }: { holding: Holding }) {
  const game = useStore((s) => s.game)!;
  const ex = rentExposure(game, holding);
  if (!ex || !ex.byInd.length) return null;
  const open = goIndustry;
  const ind = ex.byInd.slice(0, 3);
  const buyers = ex.byBuyer.slice(0, 3);
  return (
    <div className="rent-exposure">
      <div>
        Rent by tenant industry:{" "}
        {ind.map((f, i) => (
          <span key={f.key}>{i > 0 && " · "}<b>{(f.v * 100).toFixed(0)}%</b>{" "}
            <button type="button" className="biz-link" onClick={() => open(f.key)}>{shortInd(f.key as IndustryId)}</button>
          </span>
        ))}
      </div>
      <div>
        Rent rests on tenants' sales to:{" "}
        {buyers.map((f, i) => (
          <span key={f.key}>{i > 0 && " · "}<b>{(f.v * 100).toFixed(0)}%</b>{" "}
            {f.ind ? <button type="button" className="biz-link" onClick={() => open(f.key)}>{shortInd(f.ind)}</button> : f.label}
          </span>
        ))}
        {ex.covered < ex.rentYr * 0.995 && <span className="dim"> · of the {((ex.covered / (ex.rentYr || 1)) * 100).toFixed(0)}% of rent with books</span>}
      </div>
    </div>
  );
}
