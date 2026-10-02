import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { headlineEpithet } from "@/engine/firm";
import { useStore, type Page } from "@/state/store";
import { monthLabel } from "@/engine/types";
import { currentCity, currentSeed } from "@/state/city";
import { locLimit } from "@/engine/credit";
import { availability } from "@/engine/space";
import { netWorth } from "@/engine/value";
import { streetStanding, ordinal } from "@/engine/standing";
import { openResearchOn } from "@/ui/panels/shared";
import { firmBookStress, firmOverheadMonthly, portfolioMonthlyCF } from "@/engine/sim";
import { portfolioOccupancy } from "@/engine/leasing";
import { usd, pct } from "./format";
import { DESKS, deskOf, deskCount, deskLanding, tabCounts, tabLabel, visibleTabs } from "./desks";
import DeltaChip from "@/ui/vitals/DeltaChip";
import Spark from "@/ui/vitals/Spark";
import Waterfall, { usablePrev } from "@/ui/vitals/Waterfall";

/** What to call each room in the Back button. Built from the nav itself so a
 *  renamed desk cannot drift out of sync with the label on the way back. */
const PAGE_LABEL: Partial<Record<Page, string>> = {
  ...Object.fromEntries(DESKS.flatMap((d) => d.tabs.map((t) => [t.page, tabLabel(t.page) ?? t.label]))),
  none: "Map",
  property: "Property",
  saves: "Saves",
  settings: "Settings",
  primer: "Primer",
  match: "Jev match",
};

/**
 * THE WAY BACK.
 *
 * You are reading a deal, you need cash, so you go to Debt and draw on the
 * line — and now you are in the Debt desk with no way to the thing you were
 * about to sign except to find it on the map again. Every desk knows how to
 * take you somewhere; none of them knew where you came from.
 *
 * The store keeps the trail (room + deed, together — restoring one without the
 * other lands you in the right desk looking at the wrong building), and this is
 * the handle. It is in the top-left corner at all times while playing, so the
 * player never has to look for it, and it names its destination so the click is
 * a decision rather than a guess.
 */
function BackButton() {
  const depth = useStore((s) => s.navBack.length);
  const prev = useStore((s) => s.navBack[s.navBack.length - 1] ?? null);
  const goBack = useStore((s) => s.goBack);
  // Alt+Left is the muscle memory every browser trained; the map owns the bare
  // arrow keys, so it stays modified.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" || !e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      useStore.getState().goBack();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  // NAME THE PLACE, NOT THE ROUTE. A parcel desk is not a Page — it is the map
  // with a deed selected — so the honest label for that entry is the building,
  // and "Map" is only right when nothing was selected. Reading "← Map" on the
  // way back from a property is how a Back button teaches people not to trust
  // it.
  const parcels = useStore((s) => s.parcels);
  const where = !prev
    ? null
    : prev.page === "none" || prev.page === "property"
      ? (prev.bbl ? (parcels?.[prev.bbl]?.address ?? "Property") : "Map")
      : (PAGE_LABEL[prev.page] ?? "Back");
  const deed = prev?.bbl && prev.page !== "none" && prev.page !== "property"
    ? ` — and ${parcels?.[prev.bbl]?.address ?? "the deed"}` : "";
  return (
    <button
      type="button"
      className="nav-back"
      onClick={goBack}
      disabled={depth === 0}
      title={where ? `Back to ${where}${deed} (Alt+←)` : "Nowhere to go back to yet"}
      aria-label={where ? `Back to ${where}` : "Back"}
    >
      <span className="nav-back-arrow" aria-hidden="true">←</span>
      <span className="nav-back-label">{where ?? "Back"}</span>
    </button>
  );
}

// The era's headline, cut to fit an 92px tile. Long form is in the tooltip.
const ERA_SHORT: Record<string, string> = {
  postwar: "long boom",
  greatinflation: "inflation",
  volcker: "dear money",
  disinflation: "disinflation",
  zirp: "cheap money",
};

export default function TopBar() {
  const [armNewRun, setArmNewRun] = useState(false);
  // Icons-only rail. Until the player chooses, it follows the window: labels
  // from 1200px up, icons below. A choice is remembered per viewer.
  const [railPref, setRailPref] = useState<"auto" | "compact" | "full">(() => {
    try {
      const v = localStorage.getItem("bw:rail");
      if (v === "compact" || v === "full") return v;
    } catch { /* storage blocked */ }
    return "auto";
  });
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 1200);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1199px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const railCompact = railPref === "auto" ? narrow : railPref === "compact";
  const setRailCompact = (v: boolean) => {
    const next = v ? "compact" : "full";
    setRailPref(next);
    try { localStorage.setItem("bw:rail", next); } catch { /* storage blocked */ }
  };
  const fpsOn = useStore((s) => s.fpsOn);
  // When the meter is off, this selector is a constant 0 — so the once-a-second
  // MapView fps write cannot re-render the whole bar (and re-walk the book).
  const fps = useStore((s) => (s.fpsOn ? s.fps : 0));
  const manifest = useStore((s) => s.manifest);
  const game = useStore((s) => s.game);
  // Cash/date stay on the live game; portfolio walks (NW/CF/line) lag one
  // paint so a counter click is not blocked on walking the whole book.
  const deferredGame = useDeferredValue(game);
  // The pre-advance snapshot, deferred in step with the game it belongs to —
  // both are written by the same set(), so they settle on the same paint.
  const prevGame = useStore((s) => s.prevForDigest);
  const deferredPrev = useDeferredValue(prevGame);
  const mapOnly = useStore((s) => s.mapOnly);
  const setMapOnly = useStore((s) => s.setMapOnly);
  const advance = useStore((s) => s.advance);
  const advanceYear = useStore((s) => s.advanceYear);
  const advanceUntil = useStore((s) => s.advanceUntil);
  const advancing = useStore((s) => s.advancing);
  const page = useStore((s) => s.page);
  const setPage = useStore((s) => s.setPage);
  // Portfolio walks (net worth, CF, line) only when `game` changes — not on
  // every Portfolio/Books/News click, which used to recompute them for free.
  const vitals = useMemo(() => {
    if (!deferredGame) {
      return {
        nw: 0, cf: 0, occ: null as number | null, vacDpp: null as number | null,
        line: 0, counts: {} as ReturnType<typeof tabCounts>,
        dNw: null as number | null, nwSpark: [] as number[],
        dCf: null as number | null, dCfSince: null as number | null,
        dRateBp: null as number | null,
        standing: null as ReturnType<typeof streetStanding> | null,
        dRank: 0,
      };
    }
    const parcels = useStore.getState().parcels;
    const nw = parcels ? netWorth(deferredGame, parcels) : 0;
    // THE FIRM'S CASH FLOW INCLUDES THE FIRM. This was deeds less debt, and
    // the office — ~$66K a year on a one-building book — came out of the
    // account every month without ever appearing here, so an $81K readout sat
    // over a firm clearing ~$30K. Same function the tick charges.
    const firmCf = (g: typeof deferredGame) => portfolioMonthlyCF(g, parcels!) - firmOverheadMonthly(g, parcels!);
    const cf = parcels ? firmCf(deferredGame) : 0;
    const line = parcels ? locLimit(deferredGame, parcels, nw) : 0;
    // Office availability vs twelve months ago — the tell that predicts real
    // rent falls (~93% in century windows). Direct cityVac sits on its
    // frictional floor for years in a shortage and would print 0.0 forever.
    const hist = deferredGame.econ.history ?? [];
    let vacDpp: number | null = null;
    if (hist.length > 12) {
      const now = availability(deferredGame.econ, "office");
      const then = hist[hist.length - 13]?.avail?.office
        ?? hist[hist.length - 13]?.vac?.office
        ?? now;
      vacDpp = (now - then) * 100;
    }
    // THE ENGINE'S NUMBER, NOT A SECOND OPINION. This used to sum rentable
    // tenant feet over GROSS building area — its own haircut, which value.ts
    // explicitly forbids — so a fully-let building could never print 100%
    // here while Leasing called it full. One function now, shared with the
    // Leasing total: leased over lettable, operated deeds only.
    const occ = parcels ? (portfolioOccupancy(deferredGame, parcels)?.occ ?? null) : null;
    // Badges: one counter shared with the desk tabs, so the rail and the
    // tab inside the desk cannot disagree about what is waiting.
    const counts = tabCounts(deferredGame);
    // WHICH WAY, AND SINCE WHEN. ΔNW is the last two entries of the same tape
    // the Books chart draws; ΔCF walks the pre-advance snapshot with the same
    // portfolioMonthlyCF the readout uses — one quantity, one function, so the
    // chip cannot disagree with the number it sits beside. Δbp reads the rate
    // twelve months back off the tape. All of it lives in this one memo so an
    // advance still costs exactly one walk of each book.
    const nh = deferredGame.nwHistory ?? [];
    const dNw = nh.length >= 2 ? nh[nh.length - 1] - nh[nh.length - 2] : null;
    const nwSpark = nh.length >= 2 ? nh.slice(-24) : [];
    const prevOk = usablePrev(deferredGame, deferredPrev);
    const dCf = prevOk && parcels ? cf - firmCf(prevOk) : null;
    const dCfSince = prevOk ? prevOk.month : null;
    const rateThen = hist.length > 12 ? hist[hist.length - 13]?.indexRate : undefined;
    const dRateBp = rateThen === undefined ? null
      : Math.round((deferredGame.econ.indexRate - rateThen) * 100);
    // YOUR PLACE ON THE STREET, always in sight. It was two tabs deep on
    // Research, which is to say the one number that says who is winning was
    // the one the player never saw. Same ranking the league table prints.
    const standing = parcels && (deferredGame.rivals?.length ?? 0) > 0 ? streetStanding(deferredGame, parcels, nw) : null;
    // Places gained or lost since the last advance — the same ranking on the
    // pre-advance snapshot the other deltas already read.
    const standPrev = standing && prevOk && parcels ? streetStanding(prevOk, parcels) : null;
    const dRank = standing && standPrev ? standPrev.rank - standing.rank : 0;
    return {
      standing, dRank,
      nw, cf, occ, vacDpp, line, counts,
      dNw, nwSpark, dCf, dCfSince, dRateBp,
    };
  }, [deferredGame, deferredPrev]);
  const {
    nw, cf, occ, vacDpp, line, counts, dNw, nwSpark, dCf, dCfSince, dRateBp, standing, dRank,
  } = vitals;

  // WHICH TOWN IS NOT ASKED HERE ANY MORE. The island, the size and the
  // build-out used to hang off the New-city button as a three-section
  // dropdown, which measured 973px tall at 1280x720 with its confirm button
  // 353px below the bottom of the window — fourteen options and no way to
  // reach the end of them. They live on the start screen now, which has a
  // scroller and a footer that cannot scroll away. See ui/StartMenu.tsx.
  const newRunRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);

  /* THE BAR PUBLISHES ITS OWN HEIGHT.
     Everything that hangs below it — the parcel panel, the page overlays, the
     deed stamp — was positioned from a constant of 60px, and the bar has not
     been 60px tall since the firm's name went under the title: it measures 91
     at 1600px and taller still when the controls wrap to a second row at
     narrow widths. While the bar faded to transparent the overlap was
     invisible; now that it is an opaque plate, it clips the panel's address
     off the top of the card.
     Fixed by measuring rather than by choosing a bigger constant, because the
     wrap means there is no constant that is right at every width. */
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const apply = () =>
      document.documentElement.style.setProperty("--topbar-h", `${Math.round(el.getBoundingClientRect().height)}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // The armed New-city button disarms on a click anywhere else, so a campaign
  // is never one click away from being erased.
  useEffect(() => {
    if (!armNewRun) return;
    const close = (e: MouseEvent) => {
      if (newRunRef.current && !newRunRef.current.contains(e.target as Node)) setArmNewRun(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [armNewRun]);
  /* The rail publishes its width the way the bar publishes its height, so
     the page rooms and the map cards can sit beside it. */
  useEffect(() => {
    const el = railRef.current;
    const root = document.documentElement;
    if (!el) { root.style.setProperty("--rail-w", "0px"); return; }
    const apply = () => root.style.setProperty("--rail-w", `${Math.round(el.getBoundingClientRect().width)}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => { ro.disconnect(); root.style.setProperty("--rail-w", "0px"); };
  }, [!!game]);

  // THE NET-WORTH POPOVER. Plain local state, same dismissal contract as the
  // job menus plus Escape — a glance card, not a mode. The card itself is
  // position:fixed (the stats box clips its children), so its left edge is
  // measured from the readout at open time and clamped to the window.
  const [nwOpen, setNwOpen] = useState(false);
  const [nwPopLeft, setNwPopLeft] = useState(12);
  const nwRef = useRef<HTMLDivElement>(null);
  const toggleNwPop = () => {
    if (nwOpen) { setNwOpen(false); return; }
    const r = nwRef.current?.getBoundingClientRect();
    const w = Math.min(420, window.innerWidth - 24);
    setNwPopLeft(Math.max(12, Math.min(r?.left ?? 12, window.innerWidth - w - 12)));
    setNwOpen(true);
  };
  useEffect(() => {
    if (!nwOpen) return;
    const down = (e: MouseEvent) => {
      if (nwRef.current && !nwRef.current.contains(e.target as Node)) setNwOpen(false);
    };
    // Capture + stopImmediatePropagation: the Escape that dismisses this card
    // must not ALSO reach GamePanels' handler, which would close the open desk
    // (or toast about a modal) in the same keypress.
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      setNwOpen(false);
    };
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key, true);
    };
  }, [nwOpen]);
  // A tick with the card open would walk the book twice per paint — close it
  // when the clock starts; the player is watching months, not a glance card.
  useEffect(() => { if (advancing) setNwOpen(false); }, [advancing]);

  return (
    <>
    <div className="topbar" ref={barRef}>
      <div className="topbar-lead">
        {game && <BackButton />}
      </div>
      {game && (
        <div className="topbar-game">
          {/* THE READOUTS ARE THE ONLY THING ALLOWED TO SHRINK.
              This row was one flat nowrap flex line — eight readouts, six nav
              buttons, three lenses and three advance buttons — inside a bar
              laid out with space-between. Once the contents exceeded the
              window the row simply overflowed its box and the advance buttons
              came to rest ON TOP of Saves, Settings and New city. The media
              queries hid readouts one at a time to buy room, which is a guess
              about how much room is needed rather than a guarantee.
              Boxing the numbers separately makes it structural: the numbers
              can shrink and clip because every one of them is also on a page,
              and the CONTROLS cannot, because a button you cannot reach is not
              a control. */}
          {/* Vital money/time — outside the clip box. A full nav used to push
              Line into overflow:hidden and show "$5.." for a multi-million limit. */}
          <div className="topbar-summary">
          <div className="topbar-vital">
            <Stat
              label={monthLabel(game.month)}
              value={`Yr ${Math.floor(game.month / 12) + 1}`}
              wide
              w={118}
              keep
              // The calendar is a count of months; the era is the decade the
              // money behaves like. A 17% base rate under "Jan 2000" is not a
              // fault, and the tooltip is where the screen says so.
              title={game.econ.eraLabel
                ? `${game.econ.eraLabel} — ${game.econ.eraBlurb ?? ""} The calendar counts your years; the era is the decade the money behaves like.`
                : undefined}
            />
            <Stat label="Cash" value={usd(game.cash)} n={game.cash} bad={game.cash < 0} w={88} keep
              title={`GP liquidity — the firm's own cash. Vehicle cash, if any, is separate.${line > 0 && !(game.loc?.balance) ? ` Undrawn credit line ${usd(line)} on top — draw it on Capital → Debt.` : ""}`} />
            {game.fund && !game.fund.settled && (
              <Stat
                label="Vehicle"
                value={usd(game.fund.cash)}
                w={88}
                keep
                title={`Fund vehicle cash (LP capital). Called ${(game.fund.called / 1e6).toFixed(1)}M; uncalled ${(game.fund.uncalled / 1e6).toFixed(1)}M. Not GP liquidity.`}
              />
            )}
            {/* THE LINE SHOWS UP WHEN IT IS OWED. Undrawn capacity is a fact
                about the bank's appetite, and it sits in the Cash tooltip and on
                Debt; a drawn balance is money the firm owes at index + 400, and
                that is worth a readout of its own. */}
            {(game.loc?.balance ?? 0) > 0 && (
              <Stat
                label="Line drawn"
                value={`${usd(game.loc!.balance)} / ${usd(line)}`}
                bad
                keep
                w={148}
                title={`Revolver drawn ${usd(game.loc!.balance)} of ${usd(line)} available against net worth. Draw and repay on Capital → Debt.`}
                onClick={() => setPage("debt", "Line of credit")}
              />
            )}
            {/* THE NUMBER THAT ANSWERS A CLICK. Net worth moves every month for
                reasons spread across four pages; the chip says which way, the
                spark says which way it has BEEN going, and the click opens the
                waterfall — the same ledger buckets and the same appraisal the
                Books page reads, so the popover cannot disagree with the desk.
                It sat in the clip box behind a 1680px gate, which ranked the
                firm's headline number BELOW occupancy and the base rate: at
                1440 and 1600 it did not render at all, and at 1680 it rendered
                cut in half by the clip. Measured across 1280/1440/1600/1920 —
                it is a vital, so it lives with the vitals and never drops. */}
            <div className="nw-pair" ref={nwRef}>
              <Stat
                label="Net worth"
                value={usd(nw)}
                n={nw}
                w={96}
                keep
                title={`Firm going-concern equity ${usd(nw)} (cash + property − debt − deposits + CIP + notes; vehicle cash separate). Click for the waterfall — what moved it, and by how much.`}
                onClick={toggleNwPop}
                expanded={nwOpen}
              />
              {dNw !== null && (
                <span className="vital-extra">
                  <DeltaChip
                    value={dNw}
                    fmt={usd}
                    epsilon={10_000}
                    title="Net worth vs a month ago. Click the readout for the full waterfall."
                  />
                </span>
              )}
              {nwSpark.length >= 2 && (
                <span className="vital-extra">
                  <Spark values={nwSpark} title="Net worth, the last 24 months" />
                </span>
              )}
              {nwOpen && (
                <div
                  className="nw-pop"
                  role="dialog"
                  aria-label="Net worth, attributed"
                  style={{ left: nwPopLeft }}
                >
                  <button type="button" className="nw-pop-close" aria-label="Close" onClick={() => setNwOpen(false)}>
                    ✕
                  </button>
                  <Waterfall compact />
                </div>
              )}
            </div>
            {/* CF + Occupancy live in the vital strip (not droppable stats).
                They used to sit in .topbar-stats with drop 2 and vanished below
                1680px — and the whole stats box hides under 760px — so the
                occupancy readout the player asked for never appeared on a
                normal screen. Vitals stay up. */}
            {standing && (
              <Stat
                label="Street"
                value={`${ordinal(standing.rank)} / ${standing.of}${dRank > 0 ? ` ▲${dRank}` : dRank < 0 ? ` ▼${-dRank}` : ""}`}
                keep
                w={96}
                bad={dRank < 0}
                title={standing.above
                  ? `${ordinal(standing.rank)} of ${standing.of} firms by equity. Next up: ${standing.above.name} at ${usd(standing.above.eq)} — ${usd(standing.above.eq - standing.equity)} ahead. The biggest book is ${standing.leader.name} at ${usd(standing.leader.eq)}. Click for the league table.`
                  : `The biggest book in town, of ${standing.of} firms. Click for the league table.`}
                onClick={() => { openResearchOn("street"); useStore.getState().setPage("research"); }}
              />
            )}
            <span className="vital-pair">
              <Stat
                label="CF / yr"
                value={usd(cf * 12)}
                bad={cf < 0}
                keep
                w={88}
                title={`After debt service and overhead. Firm cash flow annualised: deed NOI (including ground rent) less mortgages, mezz, construction interest, facility, the revolver, and the firm's own G&A and payroll. ${usd(cf)} / mo. Reconciled 2026-08: this walk is net of every facility that actually charges. Portfolio rows now subtract mezz and a pooled facility share; their strip is still deeds-only (no construction / revolver).`}
              />
              {dCf !== null && (
                <span className="vital-extra">
                  <DeltaChip
                    value={dCf}
                    fmt={(n) => usd(n) + " /mo"}
                    epsilon={1_000}
                    title={`Monthly cash flow vs ${dCfSince !== null ? monthLabel(dCfSince) : "last month"} — the same walk as the readout, run on the pre-advance book.`}
                  />
                </span>
              )}
            </span>
            <Stat
              label="Occupancy"
              value={occ !== null ? (100 * occ).toFixed(1) + "%" : "—"}
              bad={occ !== null && occ < 0.8}
              keep
              w={80}
              title={occ !== null
                ? `Portfolio occupancy: ${(100 * occ).toFixed(1)}% of lettable feet leased across operated buildings (excludes ground-leased fees). Same total as Leasing.`
                : "Portfolio occupancy — appears once you own an operated building."}
            />
            {/* ONE READOUT FOR THE STREET. Base rate, vacancy change, the phase
                and the era used to be four separate readouts across the bar and
                the rail. They are one question — what is money and space doing
                — so they are one readout: the phase and the rate, with the
                vacancy tell turning it red when the market is softening. The
                full picture is a click away on City → Economy. */}
            <span className="vital-pair">
              <Stat
                label={game.econ.eraLabel ? `Market · ${ERA_SHORT[game.econ.eraKey ?? ""] ?? game.econ.eraLabel}` : "Market"}
                value={`${game.econ.phase} · ${pct(game.econ.indexRate)}`}
                bad={vacDpp !== null && vacDpp >= 2}
                drop={2}
                keep
                w={150}
                onClick={() => setPage("economy")}
                title={[
                  `City cycle: ${game.econ.phase}. Base rate ${pct(game.econ.indexRate)} — the benchmark every loan in town prices off; floating loans reprice to it monthly (through the cap strike, if you bought one).`,
                  vacDpp === null
                    ? "Office vacancy change appears after the first year of tape."
                    : vacDpp >= 2
                      ? `Office vacancy is ${vacDpp.toFixed(1)} points higher than a year ago — the soft-market tell. In simulated centuries, real rents were lower three years later ~93% of the time.`
                      : `Office vacancy vs a year ago: ${vacDpp >= 0 ? "+" : ""}${vacDpp.toFixed(1)} pp. Rising ≥2 pp is the soft-market tell.`,
                  game.econ.eraLabel ? `Era: ${game.econ.eraLabel} — ${game.econ.eraBlurb ?? ""}` : "",
                  "Click for the Economy.",
                ].filter(Boolean).join(" ")}
              />
              {dRateBp !== null && (
                <span className="vital-extra">
                  <DeltaChip
                    value={dRateBp}
                    fmt={(n) => `${Math.round(n)} bp`}
                    goodWhenUp={false}
                    title="Base rate vs twelve months ago. Dearer money reprices every floating loan and every new quote, so up reads as the bad direction."
                  />
                </span>
              )}
            </span>
            {/* The firm's own trouble, only when there is some. */}
            {(() => {
              const book = firmBookStress(game);
              return book.bad ? <Stat label="Book" value={book.label} bad keep w={88} title={book.title} /> : null;
            })()}
          </div>
          </div>
        </div>
      )}
      {game && (
        <div className="nav-cluster nav-cluster-time" role="group" aria-label="Time controls">
          <PlayButton />
          <button className={"advance-btn advance-main" + (advancing ? " advance-pulse" : "")} onClick={() => advance()} disabled={!!game.gameOver || advancing} title="One month (Space)">
            Advance <span className="advance-unit">1 mo</span>
          </button>
          <button className={"advance-btn advance-fast" + (advancing ? " advance-pulse" : "")} onClick={advanceYear} disabled={!!game.gameOver || advancing} title="A year, stopping if something needs you (Y)">
            {advancing ? "…" : "1 yr ▸▸"}
          </button>
          <button className={"advance-btn advance-fast" + (advancing ? " advance-pulse" : "")} onClick={advanceUntil} disabled={!!game.gameOver || advancing} title="Skip to the next thing that needs a decision, up to 3 years (N)" aria-label="Skip to next decision">
            {advancing ? "…" : "⏭"}
          </button>
        </div>
      )}
    </div>

    {/* THE SIDE RAIL. Every room in the firm, one click away, grouped by job.
        The job menus were a click to open and a click to choose, and their
        contents were invisible until you guessed which verb owned the room;
        here they are all on the page, with their counts on the room that holds
        the work. The map lenses and the campaign controls live at the foot. */}
    {game && (
      <nav className={"siderail" + (railCompact ? " siderail-compact" : "")} aria-label="Firm desks" ref={railRef}>
        <div className="brand rail-brand">
          <span className="brand-mark" aria-hidden="true">B&amp;W</span>
          <div className="rail-brand-text">
            <span className="brand-name">Broadway &amp; Wall</span>
            {/* WHO THE CITY THINKS YOU ARE. Every rival firm has a name and a
                characterisation; the player was the string "You". This is the
                headline epithet — the most quotable true thing about the firm,
                recomputed every quarter from state the player could have looked
                up themselves. It costs nothing to read and nothing to maintain. */}
            {game?.firm && (
              <span className="firm-id" title={(game.firm.epithets ?? []).map((e) => e.text).join(" · ") || "The town has not formed a view yet."}>
                <span className="firm-name">{game.firm.name}</span>
                {(() => {
                  const e = headlineEpithet(game);
                  if (!e) return null;
                  const yrs = Math.floor((game.month - e.sinceM) / 12);
                  return <span className="firm-epithet">{e.text}{yrs >= 8 ? ` — ${yrs} years now` : ""}</span>;
                })()}
              </span>
            )}
            {/* YOU DO NOT GET TO CHANGE TOWNS MID-CAMPAIGN.
                The picker used to be live for the whole run, and every island kept
                its own autosave, so a bad decade in one town was two clicks away
                from a fresh start in another and the town you were "playing" was
                never a commitment. A city you are stuck with is the premise of the
                game: the submarket you misread is the submarket you have to trade
                your way out of.
                The choice does not disappear, it moves to where it belongs — the
                start screen, which is where a run begins now. The New city button
                still asks twice before erasing anything and then goes back there. */}
            {game ? (
              <span
                className="brand-sub city-locked"
                title={`You are playing ${manifest?.city ?? currentCity()}, built from seed ${game.citySeed ?? currentSeed()}. `
                  + `A campaign belongs to its town — to play a different one, start a new game.`}
              >
                {manifest?.city ?? currentCity()}
              </span>
            ) : (
              <span className="brand-sub">
                {manifest?.city ?? (manifest?.district === "MN" ? "Manhattan" : "Lower Manhattan · CD 1")}
              </span>
            )}
            {game?.setup?.sandbox && (
              <span className="badge badge-warn" title="Sandbox: unlimited capital, no bankruptcy. Not recorded, not scored.">
                SANDBOX
              </span>
            )}
            {manifest?.source === "synthetic" && (
              <span className="badge badge-warn" title="Generated stand-in data — run `pnpm pipeline` on an open network to fetch real PLUTO data.">
                SYNTHETIC DEV DATA
              </span>
            )}
          </div>
        </div>
        <div className="siderail-scroll">
          {/* SIX DESKS. Each is a job, and the rooms that serve it are tabs
              inside (see desks.ts). The badge is everything waiting across the
              desk's tabs; the tab strip at the top of the desk says where. */}
          <div className="rail-group" role="group" aria-label="Desks">
            {DESKS.map((d) => {
              const on = deskOf(page)?.id === d.id;
              const n = deskCount(d, counts);
              const warn = d.id === "capital" ? counts.debtWarn : null;
              const debtBal = counts.debtBal ?? 0, debtWall = counts.debtWall ?? 0;
              const title = [
                `${d.label} — ${d.note} (${d.key})`,
                visibleTabs(d, game, page).length > 1 ? `Tabs: ${visibleTabs(d, game, page).map((t) => t.label).join(", ")}.` : "",
                d.id === "market" && (counts.market ?? 0) > 0 && counts.bcallSoon !== undefined
                  ? `${counts.market} file${counts.market === 1 ? "" : "s"} waiting; the soonest off-market call lapses in ${counts.bcallSoon} mo.` : "",
                d.id === "capital" && debtBal > 0
                  ? `${(debtBal / 1e6).toFixed(1)}M outstanding${warn ? ` — ${((debtWall / debtBal) * 100).toFixed(0)}% matures inside 3y` : ""}.` : "",
              ].filter(Boolean).join(" ");
              return (
                <button
                  key={d.id}
                  type="button"
                  className={"rail-item" + (on ? " on" : "")}
                  aria-current={on ? "page" : undefined}
                  title={title}
                  onClick={() => setPage(on && page !== "property" ? "none" : deskLanding(d, counts, game))}
                >
                  <span className="rail-ico" aria-hidden="true">{d.icon}</span>
                  <span className="rail-label">{d.label}</span>
                  {n > 0 ? <span className="rail-badge" aria-label={`${n} waiting`}>{n}</span>
                    : warn ? <span className="rail-badge rail-badge-warn" aria-label={warn === "swept" ? "cash sweep on" : "maturity wall"}>{warn === "swept" ? "⚠" : "!"}</span>
                    : <kbd className="rail-key" aria-hidden="true">{d.key}</kbd>}
                </button>
              );
            })}
          </div>
        </div>
        {/* THE TOOLS, ONE ROW. Saves, the primer, settings and the view modes
            are things you reach for, not places you work — icons with their
            names in the tooltip. The map lenses moved onto the map itself. */}
        <div className="rail-foot">
          <button
            type="button"
            className={"rail-item" + (page === "saves" ? " on" : "")}
            title="Saves — the live campaign autosaves; create or load named snapshots here"
            onClick={() => setPage(page === "saves" ? "none" : "saves")}
          >
            <span className="rail-ico" aria-hidden="true">⛁</span><span className="rail-label">Saves</span>
          </button>
          <button
            type="button"
            className={"rail-item" + (page === "primer" ? " on" : "")}
            title="Primer — cap rates, NOI and appraisals, in plain words"
            onClick={() => setPage(page === "primer" ? "none" : "primer")}
          >
            <span className="rail-ico" aria-hidden="true">?</span><span className="rail-label">Primer</span>
          </button>
          {(game?.rivals ?? []).some((r) => r.jev) && (
            <button
              type="button"
              className={"rail-item" + (page === "match" ? " on" : "")}
              title="Jev match — firms whose judgement Jev informs: leaderboard, equity over time, Jev's answers and what code did"
              onClick={() => setPage(page === "match" ? "none" : "match")}
            >
              <span className="rail-ico" aria-hidden="true">◆</span><span className="rail-label">Jev match</span>
            </button>
          )}
          <button
            type="button"
            className={"rail-item" + (page === "settings" ? " on" : "")}
            title="Settings — sounds, pop-up cards, broker calls, the auction card"
            onClick={() => setPage(page === "settings" ? "none" : "settings")}
          >
            <span className="rail-ico" aria-hidden="true">⚙</span><span className="rail-label">Settings</span>
          </button>
          <button
            type="button"
            className={"rail-item" + (mapOnly ? " on" : "")}
            aria-pressed={mapOnly}
            title="Map only — hide firm pages and watch the skyline (M). Inbox and glance cards stay."
            onClick={() => setMapOnly(!mapOnly)}
          >
            <span className="rail-ico" aria-hidden="true">◈</span><span className="rail-label">Map only</span><kbd className="rail-key" aria-hidden="true">M</kbd>
          </button>
          <button
            type="button"
            className="rail-item"
            title="Photo frame — hide all chrome for a clean skyline still (P)"
            onClick={() => useStore.getState().setPhotoFrame(true)}
          >
            <span className="rail-ico" aria-hidden="true">◻</span><span className="rail-label">Photo frame</span><kbd className="rail-key" aria-hidden="true">P</kbd>
          </button>
          {/* No window.confirm: a two-click arm-then-fire needs nothing from the
              browser. It erases this campaign and goes back to the start
              screen, where the next town is chosen. */}
          <div className="city-pick" ref={newRunRef}>
            <button
              type="button"
              className={"rail-item rail-danger" + (armNewRun ? " on" : "")}
              title="End this campaign and go back to the start screen, where you pick the island, the size and how built up the town is. Named saves are left alone. No holdings, the opening bankroll you choose, a brand new town."
              onClick={() => {
                if (!armNewRun) { setArmNewRun(true); setTimeout(() => setArmNewRun(false), 12000); return; }
                setArmNewRun(false);
                useStore.getState().newRun();
              }}
            >
              <span className="rail-ico" aria-hidden="true">↺</span><span className="rail-label">{armNewRun ? "Erase this game?" : "New city"}</span>
            </button>
          </div>
          {fpsOn && (
            <span className={"stat mono rail-fps " + (fps >= 55 ? "fps-good" : fps >= 30 ? "fps-ok" : "fps-bad")}>
              {fps} fps
            </span>
          )}
          <button
            type="button"
            className="rail-item rail-collapse"
            aria-pressed={railCompact}
            title={railCompact ? "Show labels" : "Icons only"}
            onClick={() => setRailCompact(!railCompact)}
          >
            <span className="rail-ico" aria-hidden="true">{railCompact ? "»" : "«"}</span><span className="rail-label">Collapse</span>
          </button>
        </div>
      </nav>
    )}
    </>
  );
}

// `drop` ranks a readout's expendability when the bar runs out of width: 3
// goes first, then 2, and anything unranked never goes. Every one of these
// numbers is also on a page — Books, the Economy — so losing one costs a
// glance, not information. The controls are not rankable: they stay.

/**
 * A READOUT THAT KEEPS ITS PLACE.
 *
 * Every stat in this bar was a content-sized flex box, so the whole row moved
 * whenever any value changed WIDTH — and the values change width constantly:
 * `$2.5M` becomes `$12.4M`, `May 2000` becomes `September 2043`, `peak` becomes
 * `recession`. Press Advance a few times and the nav buttons walk left and
 * right under the cursor, which is the reported bug and is worst for exactly
 * the player who presses Advance the most.
 *
 * The digits were already tabular so the glyphs lined up; what moved was the
 * CHARACTER COUNT, which no font setting fixes. So each readout reserves the
 * room its widest plausible value needs and grows inside its own box. `w` is
 * that reservation in pixels — wide enough for the longest month name, the
 * longest phase word, and a negative nine-figure number with a suffix.
 */
function Stat({ label, value, bad, wide, title, drop, w, keep, onClick, expanded, n }: {
  label: string; value: string; bad?: boolean; wide?: boolean; title?: string; drop?: 2 | 3; w?: number; keep?: boolean;
  /** The raw figure behind `value`: when it moves, the readout ticks green or red once. */
  n?: number;
  /** With onClick the readout renders as a real button — the number is the control. */
  onClick?: () => void; expanded?: boolean;
}) {
  const className = "tstat" + (wide ? " tstat-wide" : "") + (drop ? ` tstat-d${drop}` : "") + (keep ? " tstat-keep" : "");
  const style = w ? { minWidth: w, maxWidth: keep ? undefined : w } : undefined;
  // A MOVE YOU CAN SEE. The figure changed in place and the eye had to notice
  // the digits; one short tint says which way it went. Remounting the span
  // (keyed on the tick) replays the animation on every move.
  const prevN = useRef(n);
  const [tick, setTick] = useState<{ k: number; dir: "up" | "down" } | null>(null);
  useEffect(() => {
    const p = prevN.current;
    prevN.current = n;
    if (n === undefined || p === undefined || Math.abs(n - p) < 1) return;
    setTick((t) => ({ k: (t?.k ?? 0) + 1, dir: n > p ? "up" : "down" }));
  }, [n]);
  const body = (
    <>
      <span className="tstat-label">{label}</span>
      {value && <span key={tick?.k ?? 0} className={"tstat-value mono" + (bad ? " neg" : "") + (tick ? ` tstat-tick-${tick.dir}` : "")}>{value}</span>}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        className={className + " tstat-btn"}
        title={title}
        style={style}
        onClick={onClick}
        aria-expanded={expanded}
        aria-haspopup="dialog"
      >
        {body}
      </button>
    );
  }
  return (
    <div className={className} title={title} style={style}>
      {body}
    </div>
  );
}

/**
 * PLAY. Month, year and skip are all instant, so the skyline the map spends
 * most of its effort on was never seen growing. This runs the clock a month at
 * a time with the map drawing between ticks, and pauses itself on exactly what
 * Yr ▸▸ stops on (stopRule), on any card that wants an answer, and on game over.
 * Click again to speed up, a third time to stop. G toggles it.
 */
function PlayButton() {
  const autoplay = useStore((s) => s.autoplay);
  const over = useStore((s) => !!s.game?.gameOver);
  const next = autoplay === 0 ? 1 : autoplay === 1 ? 2 : 0;
  return (
    <button
      className={"advance-btn advance-play" + (autoplay ? " advance-play-on" : "")}
      onClick={() => useStore.getState().setAutoplay(next)}
      disabled={over}
      aria-pressed={autoplay > 0}
      title={autoplay === 0 ? "Play — a month a second, pausing when something needs you (G)"
        : autoplay === 1 ? "Playing a month a second — click for 3× (G pauses)" : "Playing at 3× — click to pause (G)"}
    >
      {autoplay === 0 ? "▶ Play" : autoplay === 1 ? "▶ 1×" : "▶ 3×"}
    </button>
  );
}
