import { useMemo } from "react";
import { useStore } from "@/state/store";
import { monthLabel, START_YEAR } from "@/engine/types";
import { dscr } from "@/engine/debt";
import { facilityMetrics } from "@/engine/facility";
import { resolveRec } from "@/engine/value";
import { usd } from "@/ui/format";
import "./rollups.css";

/**
 * THE MATURITY WALL, drawn instead of summed.
 *
 * The exposure grid above says how much of the debt lands inside three years.
 * That is a quantity; a wall is a YEAR — and which year matters more than how
 * much, because every balloon refinances in whatever credit market that year
 * happens to hold. Ten years of balloons, one bar per year, one segment per
 * loan, and each segment wears the coverage on the building underneath it —
 * the same `dscr` the lender's quarterly test reads, so the number that
 * decides whether a refinancing is routine is the number printed on the wall.
 *
 * Colors are a verdict and never travel alone: every segment prints its
 * coverage figure, and paper with nothing to test yet — interest-only, or a
 * product with no DSCR covenant — stays neutral with the figure still shown.
 */

type Tone = "ok" | "thin" | "under" | "mute";

interface Seg {
  bbl: string | null;    // null = the facility, which is the whole pool
  name: string;
  kind: "mortgage" | "mezzanine" | "facility";
  bal: number;
  matM: number;
  d: number | null;      // coverage today, from the engine's own dscr
  tone: Tone;
}

/**
 * 1.35x is comfortable, 1.20x is where lenders start reading the file, and
 * below that a balloon is not a refinancing — it is a negotiation. IO paper
 * and untested products are muted: the payment steps up later, so today's
 * coverage is not the number the test will read.
 */
function toneOf(l: { minDSCR: number; ioUntilM: number }, d: number | null, month: number): Tone {
  if (d === null || l.minDSCR <= 0 || month < l.ioUntilM) return "mute";
  return d >= 1.35 ? "ok" : d >= 1.2 ? "thin" : "under";
}

export function MaturityWall() {
  const game = useStore((s) => s.game);
  const parcels = useStore((s) => s.parcels);

  const wall = useMemo(() => {
    if (!game || !parcels) return null;
    const y0 = Math.floor(game.month / 12);
    const years: { yr: number; total: number; segs: Seg[] }[] =
      Array.from({ length: 10 }, (_, i) => ({ yr: y0 + i, total: 0, segs: [] }));
    let total = 0;   // every dollar of term debt, horizon or not
    let beyond = 0;  // matures past the ten years drawn

    const put = (seg: Seg) => {
      total += seg.bal;
      // A balloon already past due (a workout in progress) still belongs on
      // the wall — it lands in the current year, not off the left edge.
      const yi = Math.max(0, Math.floor(seg.matM / 12)) - y0;
      if (yi >= 10) { beyond += seg.bal; return; }
      const row = years[Math.max(0, yi)];
      row.total += seg.bal;
      row.segs.push(seg);
    };

    for (const h of Object.values(game.holdings)) {
      if (game.merged?.[h.bbl]) continue;
      const rec = resolveRec(parcels, game, h.bbl);
      const name = rec?.address ?? h.bbl;
      // One coverage figure per holding — the engine's dscr, the same number
      // the quarterly covenant test reads. The mezz sits behind the senior on
      // the same building, so it wears the same building's coverage.
      const d = rec ? dscr(rec, game, h) : null;
      if (h.loan && h.loan.balance > 0) {
        put({ bbl: h.bbl, name, kind: "mortgage", bal: h.loan.balance, matM: h.loan.maturityM, d, tone: toneOf(h.loan, d, game.month) });
      }
      if (h.mezz && h.mezz.balance > 0) {
        put({ bbl: h.bbl, name, kind: "mezzanine", bal: h.mezz.balance, matM: h.mezz.maturityM, d, tone: toneOf(h.mezz, d, game.month) });
      }
    }
    const f = game.facility;
    if (f && f.balance > 0) {
      const fm = facilityMetrics(game, parcels);
      put({
        bbl: null, name: `${f.lender} facility · ${f.bbls.length} deeds`, kind: "facility",
        bal: f.balance, matM: f.maturityM, d: fm.dscr,
        tone: toneOf(f, fm.dscr, game.month),
      });
    }
    for (const y of years) y.segs.sort((a, b) => a.matM - b.matM);
    const max = Math.max(1, ...years.map((y) => y.total));
    return { years, total, beyond, max, month: game.month };
  }, [game, parcels]);

  if (!wall || wall.total <= 0) return null;
  const { focus, setPage } = useStore.getState();

  return (
    <div className="page-section">
      <div className="page-section-head">The maturity wall · next ten years</div>
      <div className="wall-rows">
        {wall.years.map((y) => {
          const share = wall.total > 0 ? y.total / wall.total : 0;
          return (
            <div className="wall-row" key={y.yr}>
              <span className="wall-year">{START_YEAR + y.yr}</span>
              <div className="wall-track">
                {y.total > 0 && (
                  <div className="wall-bar" style={{ width: `${Math.max(3, (y.total / wall.max) * 100)}%` }}>
                    {y.segs.map((s) => {
                      const what = s.kind === "facility" ? s.name : `${s.name} · ${s.kind}`;
                      const cover = s.d !== null
                        ? `coverage ${s.d.toFixed(2)}x today`
                        : "no coverage to quote";
                      const label = `${what} — ${usd(s.bal)} balloons ${monthLabel(s.matM)}, ${cover}. Open the debt desk.`;
                      return (
                        <button
                          key={`${s.bbl ?? "facility"}:${s.kind}`}
                          type="button"
                          className={`wall-seg wall-${s.tone}`}
                          style={{ flexGrow: s.bal }}
                          title={label}
                          aria-label={label}
                          onClick={() => { if (s.bbl) focus(s.bbl); setPage("debt"); }}
                        >
                          {s.d !== null ? `${s.d.toFixed(2)}x` : "—"}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <span className="wall-amt">
                {y.total > 0 ? usd(y.total) : "—"}
                {share > 0.3 && <span className="wall-flag"> · the wall — {(share * 100).toFixed(0)}% of the debt</span>}
              </span>
            </div>
          );
        })}
      </div>
      {wall.beyond > 0 && (
        <div className="hint">
          {usd(wall.beyond)} more matures beyond {START_YEAR + Math.floor(wall.month / 12) + 10} and is not drawn.
        </div>
      )}
      <div className="hint">
        Green is 1.35x coverage or better, brown is 1.20–1.35x, red is under 1.20x; grey paper is
        interest-only or untested, figure shown regardless. A wall — a third of the book due in one
        year — landing in a shut credit window means refinancing on the lender's terms, or not at all.
      </div>
    </div>
  );
}
