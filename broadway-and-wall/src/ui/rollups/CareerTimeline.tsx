import { useMemo, useState } from "react";
import { useStore } from "@/state/store";
import { START_YEAR } from "@/engine/types";
import { MILESTONES } from "@/engine/sim";
import { TIER_LABEL } from "@/engine/firmCapital";
import { usd } from "@/ui/format";

/**
 * THE CAREER, YEAR BY YEAR. The tape keeps 120 stories, which in a busy late
 * game is two years — a firm forty years old could not read back its own
 * history. This is built only from the durable records the engine keeps for the
 * whole run: the December marks (net worth, place on the street, tier), the
 * milestone months, and the exits. Nothing here is re-derived or estimated.
 */
export default function CareerTimeline() {
  const game = useStore((s) => s.game)!;
  const [all, setAll] = useState(false);
  const years = useMemo(() => {
    const marks = (game.yearMarks ?? []);
    const byYear = new Map<number, { nw?: number; rank?: number; of?: number; tier?: number; holdings?: number; miles: string[]; sold: number; gain: number; forced: number; best?: { address: string; gain: number } }>();
    const at = (y: number) => {
      let r = byYear.get(y);
      if (!r) { r = { miles: [], sold: 0, gain: 0, forced: 0 }; byYear.set(y, r); }
      return r;
    };
    for (const m of marks) if (m.y >= 0) Object.assign(at(m.y), { nw: m.nw, rank: m.rank, of: m.of, tier: m.tier, holdings: m.holdings });
    for (const ms of MILESTONES) {
      const m = game.milestones?.[ms.id];
      if (m !== undefined) at(Math.floor(m / 12)).miles.push(ms.label);
    }
    for (const e of game.exits ?? []) {
      const r = at(Math.floor(e.soldM / 12));
      r.sold++; r.gain += e.gain;
      if (e.forced) r.forced++;
      if (!r.best || e.gain > r.best.gain) r.best = { address: e.address, gain: e.gain };
    }
    // The tier the firm stepped up to, if it moved this year.
    const out = [...byYear.entries()].sort((a, b) => b[0] - a[0]).map(([y, r]) => ({ y, ...r }));
    const opening = marks.find((m) => m.y === -1);
    for (let i = 0; i < out.length; i++) {
      const prevTier = i + 1 < out.length ? out[i + 1].tier : opening?.tier;
      (out[i] as { tierUp?: string }).tierUp = out[i].tier !== undefined && prevTier !== undefined && out[i].tier! > prevTier
        ? TIER_LABEL[out[i].tier!] : undefined;
    }
    return out as (typeof out[number] & { tierUp?: string })[];
  }, [game.yearMarks, game.milestones, game.exits]);

  if (!years.length) return null;
  const shown = all ? years : years.slice(0, 8);
  return (
    <div className="page-section">
      <div className="page-section-head">Your career · {years.length} year{years.length === 1 ? "" : "s"}</div>
      <table className="tbl tbl-static">
        <thead>
          <tr><th>Year</th><th className="num">Net worth</th><th className="num">Street</th><th className="num">Deeds</th><th className="num">Sales</th><th>What happened</th></tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const notes: string[] = [];
            if (r.tierUp) notes.push(`became ${r.tierUp}`);
            notes.push(...r.miles);
            if (r.best && r.sold) notes.push(`best sale ${r.best.address} (${r.best.gain >= 0 ? "+" : ""}${usd(r.best.gain)})`);
            if (r.forced) notes.push(`${r.forced} forced sale${r.forced === 1 ? "" : "s"}`);
            return (
              <tr key={r.y}>
                <td>{START_YEAR + r.y}</td>
                <td className={"num" + ((r.nw ?? 0) < 0 ? " neg" : "")}>{r.nw !== undefined ? usd(r.nw) : <span className="dim">—</span>}</td>
                <td className="num">{r.rank !== undefined ? `#${r.rank} of ${r.of}` : <span className="dim">—</span>}</td>
                <td className="num">{r.holdings ?? <span className="dim">—</span>}</td>
                <td className={"num" + (r.gain < 0 ? " neg" : "")}>{r.sold ? `${r.sold} · ${r.gain >= 0 ? "+" : ""}${usd(r.gain)}` : <span className="dim">—</span>}</td>
                <td style={{ fontSize: 12 }}>{notes.length ? notes.join(" · ") : <span className="dim">a quiet year</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {years.length > 8 && (
        <button type="button" className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => setAll(!all)}>
          {all ? "Show the last eight years" : `Show all ${years.length} years`}
        </button>
      )}
      <div className="hint" style={{ marginBottom: 0 }}>
        Net worth and place on the street are the December marks; the year still running shows only what has happened so far.
      </div>
    </div>
  );
}
