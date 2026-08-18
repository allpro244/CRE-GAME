// THE MONTH-CLOSE DOCKET — the one stream everything that wants the player
// arrives through without stopping the clock: standing attention conditions,
// the balloon and rollover watchlist, this month's tape, the year-one nudge.
// It never blocks time — the decisions that must stop the clock keep their
// cards (ui/panels/modals.tsx); this rail is for everything that can wait a
// beat but should not wait a season.
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/state/store";
import { buildDocket, SNOOZE_MONTHS, type DocketCat, type DocketItem } from "@/ui/docket/build";
import "./docket.css";

// Two-to-four letters, never color alone: the tag text is the category.
const CAT_TAG: Record<DocketCat, string> = {
  capital: "CAP", deals: "DEAL", assets: "AST", world: "CITY",
};
const CAT_TITLE: Record<DocketCat, string> = {
  capital: "Capital — debt, cash and the line",
  deals: "Deals — letters, offers and paper",
  assets: "Assets — the buildings you run",
  world: "The city",
};

export default function Docket() {
  const game = useStore((s) => s.game);
  const parcels = useStore((s) => s.parcels);
  const snooze = useStore((s) => s.docketSnooze);
  const page = useStore((s) => s.page);

  // Collapsed state survives reload; it is a reading preference, not a fact
  // about the campaign, so it lives in localStorage rather than the save.
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem("bw:docket") !== "shut"; } catch { return true; }
  });
  // The month whose arrivals the header should pulse for, or null when quiet.
  const [pulseM, setPulseM] = useState<number | null>(null);
  const prevRef = useRef<{ month: number; keys: Set<string> } | null>(null);

  const items = useMemo<DocketItem[]>(() => {
    if (!game || game.gameOver) return [];
    return buildDocket(game, parcels, snooze);
  }, [game, parcels, snooze]);

  // Pulse the header once when an advance lands a month that brought
  // something new — a snooze expiring or a re-render does not qualify.
  useEffect(() => {
    if (!game) { prevRef.current = null; return; }
    const prev = prevRef.current;
    if (prev && game.month !== prev.month && items.some((it) => !prev.keys.has(it.key))) {
      setPulseM(game.month);
    }
    prevRef.current = { month: game.month, keys: new Set(items.map((it) => it.key)) };
  }, [game, items]);

  if (!game || game.gameOver || items.length === 0) return null;

  const total = items.reduce((n, it) => n + (it.more ?? 1), 0);
  const yearOne = game.month < 12;
  const kicker = yearOne
    ? `Year one · ${12 - game.month} mo left`
    : `On your desk · ${total}`;

  const toggle = () => {
    const v = !open;
    try { localStorage.setItem("bw:docket", v ? "open" : "shut"); } catch { /* private mode */ }
    setOpen(v);
  };

  const openItem = (it: DocketItem) => {
    const st = useStore.getState();
    if (it.attnKey) { st.openAttention(it.attnKey); return; }
    if (it.bbl && it.page) { st.focus(it.bbl); st.setPage(it.page); return; }
    if (it.bbl) { st.focus(it.bbl, true); return; }
    if (it.page) st.setPage(page === it.page ? "none" : it.page);
  };
  const later = (it: DocketItem) => {
    useStore.getState().snoozeDocket(it.key, game.month + SNOOZE_MONTHS);
  };

  return (
    <div className="year-rail docket" role="status" aria-label="Month-close docket">
      <div
        className={"docket-head" + (pulseM === game.month ? " docket-head-pulse" : "")}
        onAnimationEnd={() => setPulseM(null)}
      >
        <div className="year-rail-kicker docket-kicker">{kicker}</div>
        <button
          type="button"
          className="docket-chev"
          aria-label={open ? "Collapse the docket" : "Expand the docket"}
          aria-expanded={open}
          onClick={toggle}
        >
          {open ? "▾" : "▸"}
        </button>
      </div>

      {open && (
        <div className="docket-list">
          {items.map((it) =>
            it.more !== undefined ? (
              <div key={it.key} className="docket-row docket-more">{it.title}</div>
            ) : (
              <div key={it.key} className={"docket-row" + (it.urgent ? " docket-urgent" : "")}>
                <span className={"docket-tag docket-tag-" + it.cat} title={CAT_TITLE[it.cat]}>
                  {/* the triangle carries urgency alongside the red, never instead of it */}
                  {it.urgent ? "▲ " : ""}{CAT_TAG[it.cat]}
                </span>
                <span
                  className="docket-title"
                  title={it.sub ? `${it.title} — ${it.sub}` : it.title}
                >
                  {it.title}
                  {it.sub && <span className="docket-sub mono"> · {it.sub}</span>}
                </span>
                {(it.attnKey || it.bbl || it.page) ? (
                  <button type="button" className="year-rail-go" onClick={() => openItem(it)}>
                    Open
                  </button>
                ) : <span />}
                {/* urgent items get no Later — a balloon inside six months
                    does not go away because you asked */}
                {!it.urgent ? (
                  <button
                    type="button"
                    className="year-rail-go docket-later"
                    onClick={() => later(it)}
                    title={`Back on the docket in ${SNOOZE_MONTHS} months`}
                  >
                    Later
                  </button>
                ) : <span />}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
