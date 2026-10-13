import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useStore } from "@/state/store";
import { monthLabel, type GameState, type NewsItem } from "@/engine/types";
import { rotation, storyRank, writePaper, type Story, type StorySection } from "@/engine/stories";
import { NewsText } from "@/ui/panels/MarketPage";
import { CompsSheet } from "@/ui/panels/CompsSheet";
import { ViewSwitch, useDeskView } from "@/ui/panels/shared";

// THE FRONT PAGE, THE HEADLINES AND THE PRINTS.
//
// The tab used to be the wire alone: every line the engine wrote, newest
// first, which meant "tax season" twenty-five times and the one story worth
// reading somewhere underneath. The wire is still here as Headlines, with
// repeats folded, and the closed sales as Prints. The front page is the
// paper: stories mined from the city's permanent record (engine/stories.ts),
// ranked by how surprising they are, so the thing on top is the thing worth
// knowing.

type TapeView = "front" | "headlines" | "prints";
const TAPE_VIEWS: readonly TapeView[] = ["front", "headlines", "prints"];

export const NEWS_KINDS = [
  { k: "all", label: "Everything" },
  { k: "warn", label: "Warnings" },
  { k: "event", label: "Events" },
  { k: "deal", label: "Deals" },
  { k: "info", label: "Notices" },
  { k: "rumor", label: "Rumors" },
  // Not a kind on the wire: every item about a deed you hold or once held.
  { k: "mine", label: "Your book" },
] as const;

const SECTIONS: { k: StorySection; head: string; blurb: string; max: number }[] = [
  { k: "yours", head: "Your corner", blurb: "Your block, your buildings' pasts, and what became of what you sold.", max: 4 },
  { k: "deeds", head: "Deeds with a past", blurb: "The strangest histories in the land records.", max: 4 },
  { k: "street", head: "The street", blurb: "Who is buying, who left whom, and who is gone.", max: 3 },
  { k: "places", head: "Neighbourhoods", blurb: "What the cranes, the stations and the planners did.", max: 3 },
  { k: "skyline", head: "Skyline & records", blurb: "The tallest, the dearest, the oldest.", max: 3 },
];

/** At most this many stories of one kind per section — a bust is one story, not twelve haircuts. */
const PER_KICKER = 2;

/**
 * The wire's repeat key: the line with its amounts taken out. "Tax season:
 * $1.12M due" and "Tax season: $1.26M due" are the same notice. Whole numbers
 * stay, because a house number is what makes "took 112 Old Trinity Pl" a
 * different deal from "took 40 Old Trinity Pl".
 */
const wireKey = (t: string) =>
  t.replace(/[−-]?\$[\d,.]+[MKB]?/g, "$#").replace(/[−-]?\d+(\.\d+)?%/g, "#%").replace(/\d+\.\d+/g, "#")
    .replace(/\b\d+ (cents|months?|years?|points?)\b/g, "# $1");

/**
 * THE TAPE — what happened. The paper, the wire's headlines and the closed
 * sales are the same kind of thing, the record rather than the model, so they
 * share a tab: the prints came over from Research, where they were the eighth
 * sub-tab.
 */
export function NewsPage() {
  const game = useStore((s) => s.game)!;
  const [view, setView] = useDeskView<TapeView>("news", "front", TAPE_VIEWS);
  const prints = (game.comps ?? []).length;
  const switcher = (
    <ViewSwitch<TapeView>
      label="Tape"
      on={view}
      set={setView}
      views={[
        { id: "front", label: "Front page", title: "Stories dug out of the deed histories, the street and your own book" },
        { id: "headlines", label: "Headlines", n: (game.news ?? []).length },
        { id: "prints", label: "Prints", n: prints, title: "Closed sales — the price paid, the cap rate it implies, and who was on each side" },
      ]}
    />
  );
  if (view === "prints") return <div>{switcher}<CompsSheet /></div>;
  if (view === "headlines") return <Headlines switcher={switcher} />;
  return <div className="paper">{switcher}<FrontPage onWire={() => setView("headlines")} /></div>;
}

// ---------------------------------------------------------------- front page

function FrontPage({ onWire }: { onWire: () => void }) {
  const game = useStore((s) => s.game)!;
  const parcels = useStore((s) => s.parcels);
  // The paper is printed once a month: the record it reads only grows when
  // the clock moves or the player trades.
  const holdKey = Object.keys(game.holdings).join(",");
  const exitN = (game.exits ?? []).length;
  const paper = useMemo(
    () => (parcels ? writePaper(game, parcels) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [game.month, parcels, holdKey, exitN],
  );
  if (!paper) return null;

  const layout = lay(paper.stories, game.month);
  const headlines = wireHeadlines(game);

  return (
    <div className="paper-front">
      <div className="paper-mast">
        <div className="paper-mast-name">The Tape</div>
        <div className="paper-mast-line">
          <span>{monthLabel(game.month)}</span>
          <span>Edition {game.month + 1}</span>
          <span>{paper.stories.length} stories in the record</span>
        </div>
      </div>

      {!layout.lead && (
        <div className="hint">
          The city is too young for stories yet — a deed needs a history before it has a past. Until then, the
          wire below is everything that has happened.
        </div>
      )}

      {layout.lead && <StoryCard s={layout.lead} month={game.month} lead />}

      {headlines.length > 0 && (
        <div className="paper-box paper-wire-box">
          <div className="paper-box-head">
            <span>Off the wire this month</span>
            <button className="news-link" onClick={onWire}>All headlines →</button>
          </div>
          {headlines.map((n, i) => (
            <div
              key={i}
              className={"news-item news-" + n.kind + (n.bbl ? " news-clickable" : "")}
              onClick={n.bbl ? () => useStore.getState().focus(n.bbl!, true) : undefined}
            >
              <NewsText text={n.text} />{n.bbl ? " ✈" : ""}
            </div>
          ))}
        </div>
      )}

      {SECTIONS.map((sec) => {
        const rows = layout.sections[sec.k];
        if (!rows.length) return null;
        return (
          <div key={sec.k} className="page-section">
            <div className="page-section-head">{sec.head}</div>
            <div className="hint paper-blurb">{sec.blurb}</div>
            <div className="paper-grid">
              {rows.map((s) => <StoryCard key={s.id} s={s} month={game.month} />)}
            </div>
          </div>
        );
      })}

      {(paper.numbers.length > 0 || paper.almanac.length > 0) && (
        <div className="paper-grid paper-foot">
          {paper.numbers.length > 0 && (
            <div className="paper-box">
              <div className="paper-box-head"><span>By the numbers · last twelve months</span></div>
              <table className="paper-stats">
                <tbody>
                  {paper.numbers.map((n) => (
                    <tr key={n.label}>
                      <td>{n.label}</td>
                      <td className="num">{n.value}</td>
                      <td className={n.flag ? "paper-flag" : "paper-dim"}>{n.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {paper.almanac.length > 0 && (
            <div className="paper-box">
              <div className="paper-box-head"><span>The almanac</span></div>
              {paper.almanac.map((a, i) => (
                <div
                  key={i}
                  className={"paper-almanac" + (a.bbl ? " news-clickable" : "")}
                  onClick={a.bbl ? () => useStore.getState().focus(a.bbl!, true) : undefined}
                >
                  {a.text}{a.bbl ? " ✈" : ""}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Which stories make the page. Rank is surprise plus freshness; a small
 * seasonal rotation shuffles stories of similar rank so the deeper features
 * change over a year instead of sitting on the page for a decade.
 */
function lay(stories: Story[], month: number) {
  const ranked = stories
    .map((s) => ({ s, r: storyRank(s, month) + rotation(s.id, month) * 1.2 }))
    .sort((a, b) => b.r - a.r)
    .map((x) => x.s);
  // The lead is the best story that is still news — something from the last
  // two years — and failing that, the best story full stop.
  const lead = ranked.find((s) => month - s.m <= 24) ?? ranked[0] ?? null;
  const sections = {} as Record<StorySection, Story[]>;
  for (const sec of SECTIONS) {
    const kinds = new Map<string, number>();
    sections[sec.k] = [];
    for (const s of ranked) {
      if (s === lead || s.section !== sec.k || sections[sec.k].length >= sec.max) continue;
      const n = kinds.get(s.kicker) ?? 0;
      if (n >= PER_KICKER) continue;
      kinds.set(s.kicker, n + 1);
      sections[sec.k].push(s);
    }
  }
  return { lead, sections };
}

/**
 * A plain sale on the wire — "X took 12 Main St at $3.7M", "Sold in The
 * Wharves: …". Those are comps; they live under Prints, not on the front page.
 */
const SALE_LINE = /\btook\b.*\bat \$[\d.,]+[MKB]?|^Sold in |\bwent to\b.*\bat \$[\d.,]+[MKB]?/;

/**
 * This month's wire, loudest first. A notice the wire has run before — tax
 * season, the same loan on offer again — is routine, not a headline.
 */
function wireHeadlines(g: GameState): NewsItem[] {
  const order = { warn: 0, event: 1, deal: 2, rumor: 3, info: 4 } as const;
  const times = new Map<string, number>();
  for (const n of g.news ?? []) times.set(wireKey(n.text), (times.get(wireKey(n.text)) ?? 0) + 1);
  return (g.news ?? [])
    .filter((n) => n.q >= g.month - 1 && times.get(wireKey(n.text)) === 1 && !SALE_LINE.test(n.text))
    .sort((a, b) => b.q - a.q || order[a.kind] - order[b.kind])
    .slice(0, 5);
}

function StoryCard({ s, month, lead }: { s: Story; month: number; lead?: boolean }) {
  const [open, setOpen] = useState(false);
  const fresh = month - s.m <= 1;
  return (
    <article className={"paper-story" + (lead ? " paper-lead" : "") + (s.mine ? " paper-mine" : "")}>
      <div className="paper-kicker">
        {s.kicker}
        {fresh && <span className="paper-new">New</span>}
      </div>
      <h3 className="paper-head">{s.head}</h3>
      <p className="paper-body">{s.body}</p>
      <div className="paper-meta">
        <span>{monthLabel(s.m)}</span>
        {s.bbl && (
          <button className="news-link" onClick={() => useStore.getState().focus(s.bbl!, true)}>Go there ✈</button>
        )}
        {s.beats && s.beats.length > 1 && (
          <button className="news-link" onClick={() => setOpen(!open)}>
            {open ? "Hide the record" : `The whole record · ${s.beats.length}`}
          </button>
        )}
      </div>
      {open && s.beats && (
        <ol className="paper-beats">
          {s.beats.map((b, i) => (
            <li key={i} className={b.tone ? `paper-beat-${b.tone}` : undefined}>
              <span className="paper-beat-when">{monthLabel(b.m)}</span> {b.text}
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

// ------------------------------------------------------------------- the wire

function Headlines({ switcher }: { switcher: ReactNode }) {
  const game = useStore((s) => s.game)!;
  const [kind, setKind] = useState<string>("all");
  // A deed you hold now, or sold — the story of your book includes its exits.
  const mine = new Set([...Object.keys(game.holdings), ...(game.exits ?? []).map((e) => e.bbl), ...(game.watch ?? [])]);
  const isMine = (n: { bbl?: string }) => !!n.bbl && mine.has(n.bbl);
  // THE SAME LINE, ONCE. Standing conditions write themselves into the tape
  // every month they hold — "2 parties are chasing the same 1.8k sf at …",
  // "You have 11k sf waiting on leases and only $266K …" — so one fact filled
  // a dozen months of the feed. The newest copy stays, with how many earlier
  // months said the same thing (amounts aside); the older copies fold into it.
  const keeperOf = new Map<string, object>();
  const repeats = new Map<object, number>();
  const filtered = (game.news ?? []).filter((n) => kind === "all" || (kind === "mine" ? isMine(n) : n.kind === kind));
  const items = filtered.filter((n) => {
    const k = `${n.kind}|${wireKey(n.text)}`;
    const keeper = keeperOf.get(k);
    if (!keeper) { keeperOf.set(k, n); return true; }
    repeats.set(keeper, (repeats.get(keeper) ?? 0) + 1);
    return false;
  });
  const byMonth: { q: number; rows: typeof items }[] = [];
  for (const n of items) {
    const last = byMonth[byMonth.length - 1];
    if (last && last.q === n.q) last.rows.push(n);
    else byMonth.push({ q: n.q, rows: [n] });
  }
  const counts: Record<string, number> = { all: (game.news ?? []).length };
  for (const n of game.news ?? []) {
    counts[n.kind] = (counts[n.kind] ?? 0) + 1;
    if (isMine(n)) counts.mine = (counts.mine ?? 0) + 1;
  }

  return (
    <div>
      {switcher}
      <div className="hint">
        The last {(game.news ?? []).length} items off the wire, newest first. Anything marked ✈ is about a
        specific place — a building, or a civic work. Click it and the camera goes there.
      </div>
      <div className="btn-row" style={{ marginBottom: 8, flexWrap: "wrap" }}>
        {NEWS_KINDS.map((t) => (
          <button
            key={t.k}
            className={"lens-btn" + (kind === t.k ? " lens-on" : "")}
            onClick={() => setKind(t.k)}
          >
            {t.label}{counts[t.k] ? ` · ${counts[t.k]}` : ""}
          </button>
        ))}
      </div>
      {!items.length && (
        <div className="deal">
          <div className="hint">Nothing under that heading yet.</div>
          {kind !== "all" && (
            <button className="btn" onClick={() => setKind("all")}>Show everything →</button>
          )}
        </div>
      )}
      {byMonth.map((g) => (
        <div key={g.q} className="page-section" style={{ marginTop: 6 }}>
          <div className="page-section-head">{monthLabel(g.q)}</div>
          <div className="news">
            {g.rows.map((n, i) => (
              <div
                key={i}
                className={"news-item news-" + n.kind + (n.bbl ? " news-clickable" : "") + (isMine(n) ? " news-mine" : "")}
                onClick={n.bbl ? () => { useStore.getState().focus(n.bbl!, true); } : undefined}
              >
                <NewsText text={n.text} />{n.bbl ? " ✈" : ""}
                {(repeats.get(n) ?? 0) > 0 && (
                  <span className="news-repeat" title="The same line ran in earlier months too; only the newest is shown.">
                    {" "}· also {repeats.get(n)} earlier {repeats.get(n) === 1 ? "time" : "times"}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
