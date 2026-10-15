import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, pendingGoal } from "@/state/store";
import { GOALS, type GoalId } from "@/engine/goals";
import { START_CASH_CHOICES } from "@/engine/types";
import { competitorOpeningRange } from "@/engine/rivals";
import {
  DEFAULT_SETUP, FIELDS, HOME_OPTIONS, RIVAL_CAPITAL, CLOCK_OPTIONS, CASH_MIN, CASH_MAX, SANDBOX_CASH,
  type GameSetup, type FieldChoice, type HomeChoice, type RivalCapital,
} from "@/engine/setup";
import { generateFirmName } from "@/engine/firm";
import { currentCity, currentSize, currentDev, currentCash0 } from "@/state/city";
import { cityList, cityName, sizeList, developmentList, extentList, randomSeed, PARK_AMOUNTS } from "@/citygen/index.mjs";
import { drawPlatOffThread } from "@/state/platClient";
import { BUILD_STAMP } from "@/buildStamp";
import { usd } from "./format";

/**
 * THE GAME SETUP PAGE — which world you play in.
 *
 * Every control here is about the player and the town, never the economy,
 * and never a dial (CLAUDE.md, "DIFFICULTY IS AN OUTPUT, NOT A DIAL"). The
 * economy is simulated before month one (engine/regime.ts) and is met on the
 * tape. No presets either (owner, Oct 2026): a run is set up from its parts.
 *
 * The default is the standard game exactly — test/setup.mjs holds that with a
 * state hash — so a player who presses Break ground without touching anything
 * plays the game everybody else plays.
 */

/** What each opening cheque buys, in the game's own numbers. */
const CASH_NOTE: Record<number, string> = {
  1_000_000: "One small building outright, or two with debt, and almost no reserve.",
  2_500_000: "The standard opening. Room for a couple of buildings and a reserve to carry a lease-up.",
  5_000_000: "A real first book. Enough to be wrong once and still be in business.",
  10_000_000: "A small institutional platform: a diversified first book.",
  20_000_000: "A serious acquisition book from the first month.",
};

interface Draft {
  island: string; size: string; dev: string; cash0: number; goal: GoalId | null;
  field: FieldChoice; inherit: 0 | 2 | 3 | 4; home: HomeChoice; rivalCapital: RivalCapital;
  parks: "low" | "medium" | "high";
  firmName: string; sandbox: boolean; clock: NonNullable<GameSetup["clock"]>; brokerStops: boolean; seed: number; poolEntry: boolean; rivalReputation: boolean; rivalDealTerms: boolean;
}


const SECTIONS = [
  { id: "city", label: "City" },
  { id: "firm", label: "Starting firm" },
  { id: "competition", label: "Competition" },
  { id: "goal", label: "Goal" },
  { id: "clock", label: "The clock" },
  { id: "seed", label: "Seed" },
  { id: "sandbox", label: "Sandbox" },
  { id: "map", label: "The map" },
] as const;


export default function GameSetup({ onBack }: { onBack?: () => void }) {
  const phase = useStore((s) => s.phase);
  const startRun = useStore((s) => s.startRun);
  const popupsOff = useStore((s) => s.popupsOff);
  const setPopupsOff = useStore((s) => s.setPopupsOff);
  const loadError = useStore((s) => s.loadError);

  const cities = cityList();
  const sizes = sizeList();
  const devs = developmentList();

  const fresh = (): Draft => {
    const island = currentCity();
    return {
      island, size: currentSize(island), dev: currentDev(island), cash0: currentCash0(), goal: null,
      field: DEFAULT_SETUP.field, inherit: 0, home: "any", rivalCapital: "medium", parks: "medium",
      firmName: "", sandbox: false, clock: "decisions", brokerStops: true, seed: randomSeed(), poolEntry: true, rivalReputation: true, rivalDealTerms: false,
    };
  };
  const [d, setD] = useState<Draft>(fresh);
  const up = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const isWritten = !!cities.find((c) => c.id === d.island)?.extents;
  const pickIsland = (id: string) => up({ island: id, size: currentSize(id), dev: currentDev(id) });

  const [cashText, setCashText] = useState("");
  const [seedText, setSeedText] = useState(String(d.seed));
  useEffect(() => setSeedText(String(d.seed)), [d.seed]);

  // THE SEED'S MAP. Drawn off the page's thread whenever anything that shapes
  // the town changes — island, size, build-out, parks, seed — after a short
  // pause, so typing a seed or clicking New seed a few times draws one map.
  // Same makeCity call Break ground makes, so this is the town you will get.
  const [plat, setPlat] = useState<{ key: string; svg?: string; lots?: number; err?: string } | null>(null);
  const platKey = `${d.island}|${d.size}|${d.dev}|${d.parks}|${d.seed}`;
  useEffect(() => {
    if (isWritten) return;
    let gone = false;
    const t = setTimeout(() => {
      void drawPlatOffThread({ island: d.island, seed: d.seed, size: d.size, dev: d.dev, parks: d.parks === "medium" ? undefined : d.parks })
        .then((r) => { if (!gone) setPlat({ key: platKey, svg: r.svg, lots: r.lots, err: r.err }); });
    }, 250);
    return () => { gone = true; clearTimeout(t); };
  }, [platKey, isWritten]);
  const platFresh = plat?.key === platKey;
  const customCash = !START_CASH_CHOICES.includes(d.cash0 as never);


  const randomiseAll = () => {
    const r = Math.random;
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
    const island = d.island;
    setD({
      ...d,
      size: isWritten ? pick(extentList()).id : pick(sizes).id,
      dev: pick(devs).id,
      cash0: pick(START_CASH_CHOICES),
      field: pick(FIELDS).id,
      rivalCapital: pick(RIVAL_CAPITAL).id,
      parks: pick(PARK_AMOUNTS).id,
      inherit: pick([0, 0, 2, 3, 4] as const),
      home: pick(HOME_OPTIONS).id,
      goal: pick([null, ...GOALS.map((g) => g.id)]),
      seed: randomSeed(),
      island,
      sandbox: false,
    });
  };

  // ---- section rail: which section is in view
  const bodyRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string>("city");
  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    // The section whose top has crossed the upper third of the scroller; at
    // the very bottom, the last one (it may never reach the line).
    const onScroll = () => {
      const line = root.getBoundingClientRect().top + root.clientHeight * 0.3;
      let cur: string = SECTIONS[0].id;
      for (const s of SECTIONS) {
        const el = document.getElementById(`setup-${s.id}`);
        if (el && el.getBoundingClientRect().top <= line) cur = s.id;
      }
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 4) cur = SECTIONS[SECTIONS.length - 1].id;
      setActive(cur);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => root.removeEventListener("scroll", onScroll);
  }, []);
  // On a narrow window the rail is a chip row; keep the live chip in it.
  const railRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const rail = railRef.current;
    const chip = rail?.querySelector<HTMLElement>(".setup-rail-item.on");
    if (!rail || !chip || rail.scrollWidth <= rail.clientWidth) return;
    const l = chip.offsetLeft - rail.offsetLeft, r = l + chip.offsetWidth;
    if (l < rail.scrollLeft) rail.scrollLeft = l - 8;
    else if (r > rail.scrollLeft + rail.clientWidth) rail.scrollLeft = r - rail.clientWidth + 8;
  }, [active]);
  const go = (id: string) => document.getElementById(`setup-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const islandWord = cityName(d.island, d.seed) || cities.find((c) => c.id === d.island)?.name || "the island";
  const firmPlaceholder = generateFirmName(d.seed).name;
  const sizeName = isWritten ? extentList().find((e) => e.id === d.size)?.name : sizes.find((s) => s.id === d.size)?.name;
  const devName = devs.find((x) => x.id === d.dev)?.name;
  const opening = d.sandbox ? SANDBOX_CASH : d.cash0;

  const summary = useMemo(() => {
    const bits = [
      d.field !== "standard" ? "before the opportunity funds" : null,
      d.inherit ? `${d.inherit} family buildings` : null,
      d.rivalCapital !== "medium" ? `competitors' money: ${RIVAL_CAPITAL.find((c) => c.id === d.rivalCapital)?.label.toLowerCase()}` : null,
      d.parks !== "medium" && !isWritten ? `${PARK_AMOUNTS.find((x) => x.id === d.parks)?.name.toLowerCase()} parks` : null,
    ].filter(Boolean);
    return bits.join(" · ");
  }, [d.field, d.inherit, d.rivalCapital, d.parks, isWritten]);

  const breakGround = () => {
    pendingGoal.id = d.sandbox ? null : d.goal;
    const setup: Partial<GameSetup> = {
      field: d.field, inherit: d.inherit, home: d.home,
      rivalCapital: d.rivalCapital === "medium" ? undefined : d.rivalCapital,
      // a written-down city's parks are real: the choice only applies to a generated island
      parks: d.parks === "medium" || isWritten ? undefined : d.parks,
      firmName: d.firmName.trim() || undefined, sandbox: d.sandbox, clock: d.clock,
      brokerStops: d.brokerStops ? undefined : "never",
      poolEntry: d.poolEntry ? undefined : false,
      rivalReputation: d.rivalReputation ? undefined : false,
      rivalDealTerms: d.rivalDealTerms ? true : undefined,
    };
    void startRun(d.island, d.size, d.dev, d.cash0, setup, d.seed);
  };

  const opt = (on: boolean, onClick: () => void, name: React.ReactNode, note: React.ReactNode, key?: string, disabled?: boolean) => (
    <button key={key} type="button" className={"start-opt" + (on ? " start-opt-on" : "")} aria-pressed={on} onClick={onClick} disabled={disabled}>
      <span className="start-opt-name">{name}</span>
      <span className="start-opt-note">{note}</span>
    </button>
  );

  return (
    <div className="start setup">
      <div className="start-head setup-head">
        <div className="setup-head-row">
          <div>
            <div className="setup-kicker">New campaign</div>
            <div className="start-title">Game setup</div>
            <div className="start-sub">
              Which town you play in and the firm you bring to it. Nothing on this page is a difficulty setting, and the
              economy is not on it at all — it is drawn fresh every game.
            </div>
          </div>
          {onBack && <button type="button" className="setup-back" onClick={onBack}>◂ Back</button>}
        </div>
      </div>

      <div className="setup-frame">
        <nav className="setup-rail" aria-label="Setup sections" ref={railRef}>
          {SECTIONS.map((s, i) => (
            <button key={s.id} type="button" className={"setup-rail-item" + (active === s.id ? " on" : "")} onClick={() => go(s.id)}>
              <span className="setup-rail-n">{i + 1}</span>{s.label}
            </button>
          ))}
        </nav>

        <div className="start-body setup-body" ref={bodyRef}>

          {/* ------------------------------------------------------------- city */}
          <section id="setup-city" className="setup-sec">
            <h2 className="setup-h"><span className="setup-n">1</span>City</h2>
            <p className="setup-lede">You do not get to change town mid-campaign. A run belongs to its island.</p>
            <div className="start-cols setup-cols3">
              <div className="start-col">
                <div className="start-col-head">where</div>
                {cities.map((c) => opt(c.id === d.island, () => pickIsland(c.id), c.name, c.tagline, c.id))}
              </div>
              <div className="start-col">
                <div className="start-col-head">{isWritten ? "how far uptown" : "how big"}</div>
                {isWritten
                  ? extentList().map((e) => opt(e.id === d.size, () => up({ size: e.id }), e.name, e.note, e.id))
                  : sizes.map((s) => opt(s.id === d.size, () => up({ size: s.id }), <>{s.name}<span className="start-opt-lots"> · about {lotsAt(s.k)} lots</span></>, s.note, s.id))}
              </div>
              <div className="start-col">
                <div className="start-col-head">how built up</div>
                {devs.map((x) => opt(x.id === d.dev, () => up({ dev: x.id }), x.name, x.note, x.id))}
              </div>
            </div>
            {/* HOW MUCH OF IT IS PARK. Part of the town, like its size: it moves
                the odds of which park plan the island draws and how many parks
                that plan lays down. Manhattan's parks are the real ones. */}
            {!isWritten && (
              <div className="start-cols setup-cols3">
                <div className="start-col">
                  <div className="start-col-head">how many parks</div>
                  {PARK_AMOUNTS.map((x) => opt(x.id === d.parks, () => up({ parks: x.id }), x.name, x.note, x.id))}
                </div>
              </div>
            )}
          </section>

          {/* ------------------------------------------------------------- firm */}
          <section id="setup-firm" className="setup-sec">
            <h2 className="setup-h"><span className="setup-n">2</span>Starting firm</h2>
            <div className="start-cols setup-cols2">
              <div className="start-col">
                <div className="start-col-head">capital</div>
                {START_CASH_CHOICES.map((v) => opt(v === d.cash0 && !d.sandbox, () => { up({ cash0: v }); setCashText(""); }, usd(v), CASH_NOTE[v], String(v), d.sandbox))}
                <div className="setup-row" style={{ padding: "6px 9px" }}>
                  <label className="setup-label" htmlFor="setup-cash">Custom</label>
                  <input id="setup-cash" className={"setup-input mono" + (customCash ? " on" : "")} inputMode="decimal" disabled={d.sandbox}
                    placeholder={`$${CASH_MIN / 1e6}M – $${CASH_MAX / 1e6}M`}
                    value={cashText} onChange={(e) => {
                      setCashText(e.target.value);
                      const m = Number(e.target.value.replace(/[$,m\s]/gi, ""));
                      if (Number.isFinite(m) && m > 0) up({ cash0: Math.round(Math.max(CASH_MIN, Math.min(CASH_MAX, m * 1e6)) / 50_000) * 50_000 });
                    }} />
                  <span className="setup-dim">in $M{customCash ? ` → ${usd(d.cash0)}` : ""}</span>
                </div>
                {/* WHAT YOU ARE UP AGAINST. The competitors' cheques are drawn
                    when the town is cut, so this is the range for this town
                    size and field, not a setting: how much they bring is the
                    market's, not a difficulty dial. */}
                {(() => {
                  const cr = competitorOpeningRange(d.size, d.field, d.rivalCapital);
                  const cash = d.sandbox ? SANDBOX_CASH : d.cash0;
                  const rank = cr.rankOf(cash);
                  const nth = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
                  return (
                    <div className="setup-dim" style={{ padding: "6px 9px" }}>
                      Competitors in a town this size open with {usd(cr.lo)}–{usd(cr.hi)} each, about {usd(cr.typical)} typical.
                      {" "}{usd(cash)} would open around {nth(rank)} of {cr.firms + 1}.
                    </div>
                  );
                })()}
              </div>
              <div className="start-col">
                <div className="start-col-head">the opening book</div>
                {opt(d.inherit === 0, () => up({ inherit: 0 }), "Start from nothing", "Cash and a desk. Every deed on the book is one you bought or built.", "inh0")}
                {([2, 3, 4] as const).map((n) => opt(d.inherit === n, () => up({ inherit: n }), `Inherit ${n} family buildings`,
                  n === 2 ? "A corner shop and a walk-up, say." : n === 3 ? "A small family book." : "Most of what a family accumulates in a generation.", `inh${n}`))}
                <div className="start-opt-note" style={{ padding: "4px 9px 2px" }}>
                  Small buildings ($0.6–3.5M) from the town&rsquo;s own stock, with their real rent rolls and fresh
                  hometown-bank paper at 35% — family leverage. They come in kind at the appraiser&rsquo;s number: no cash
                  changes hands, and the rolls, deposits and roofs are yours from month one.
                </div>
                <div className="start-col-head" style={{ marginTop: 10 }}>where the family bought</div>
                <div className="setup-seg" role="radiogroup" aria-label="Where the family's buildings are">
                  {HOME_OPTIONS.map((h) => (
                    <button key={h.id} type="button" role="radio" aria-checked={d.home === h.id} disabled={!d.inherit}
                      className={"setup-seg-btn" + (d.home === h.id ? " on" : "")} title={h.note} onClick={() => up({ home: h.id })}>{h.label}</button>
                  ))}
                </div>
                <div className="start-opt-note" style={{ padding: "4px 2px" }}>
                  {d.inherit ? HOME_OPTIONS.find((h) => h.id === d.home)?.note : "Only matters with a family book."}
                </div>
                <div className="start-col-head" style={{ marginTop: 10 }}>firm name</div>
                <input className="setup-input setup-input-wide" placeholder={firmPlaceholder} value={d.firmName} maxLength={48}
                  aria-label="Firm name" onChange={(e) => up({ firmName: e.target.value })} />
                <div className="start-opt-note" style={{ padding: "4px 2px" }}>Leave blank for the name the seed draws: {firmPlaceholder}.</div>
              </div>
            </div>
          </section>

          {/* ------------------------------------------------------ competition */}
          <section id="setup-competition" className="setup-sec">
            <h2 className="setup-h"><span className="setup-n">3</span>Competition</h2>
            <p className="setup-lede">
              Which generation of capital owns the town on day one. How MANY firms the town supports is an output, not a
              setting: funds are raised in good years and fail in bad ones, and the roster is sized to the map.
            </p>
            <div className="start-cols setup-cols2">
              <div className="start-col">
                <div className="start-col-head">the incumbents</div>
                {FIELDS.map((f) => opt(d.field === f.id, () => up({ field: f.id }), f.label, f.note, f.id))}
                <div className="start-col-head" style={{ marginTop: 10 }}>how much they start with</div>
                <div className="setup-seg" role="radiogroup" aria-label="How much money the competitors start with">
                  {RIVAL_CAPITAL.map((c) => (
                    <button key={c.id} type="button" role="radio" aria-checked={d.rivalCapital === c.id}
                      className={"setup-seg-btn" + (d.rivalCapital === c.id ? " on" : "")} title={c.note}
                      onClick={() => up({ rivalCapital: c.id })}>{c.label}</button>
                  ))}
                </div>
                <div className="start-opt-note" style={{ padding: "4px 2px" }}>
                  {(() => {
                    const c = RIVAL_CAPITAL.find((x) => x.id === d.rivalCapital)!;
                    const cr = competitorOpeningRange(d.size, d.field, d.rivalCapital);
                    return `${c.note} Each opens with ${usd(cr.lo)}–${usd(cr.hi)}, about ${usd(cr.typical)} typical.`;
                  })()}
                </div>
                <label className="setup-check" style={{ marginTop: 10 }}>
                  <input type="checkbox" checked={d.poolEntry} onChange={(e) => up({ poolEntry: e.target.checked })} />
                  <span><strong>New firms raise from the city's investor money</strong><br />
                    <span className="start-opt-note">One capital market: a new competitor's first close comes out of the same yearly pool you raise from, so fewer firms open when the money has gone — to them or to you. Off, new firms raise from money that never runs out.</span></span>
                </label>
                <label className="setup-check" style={{ marginTop: 10 }}>
                  <input type="checkbox" checked={d.rivalReputation} onChange={(e) => up({ rivalReputation: e.target.checked })} />
                  <span><strong>Competitors raise on their record</strong><br />
                    <span className="start-opt-note">A team that spins out of a firm carries part of its old firm's record, and a better record raises a bigger first fund from deeper money. Off, every new firm raises like a new name.</span></span>
                </label>
                <label className="setup-check" style={{ marginTop: 10 }}>
                  <input type="checkbox" checked={d.rivalDealTerms} onChange={(e) => up({ rivalDealTerms: e.target.checked })} />
                  <span><strong>Builders raise each job on their record</strong><br />
                    <span className="start-opt-note">A competitor's deal investors sign the same terms you do: an unknown builder raises a dollar per dollar of its own, a proven one six, a top one nine, one that lost its investors' money little or nothing. Off, every builder raises nine to one. On makes a smaller, slower city — fewer builders can afford to build.</span></span>
                </label>
              </div>
            </div>
          </section>

          {/* ------------------------------------------------------------- goal */}
          <section id="setup-goal" className="setup-sec">
            <h2 className="setup-h"><span className="setup-n">4</span>Goal</h2>
            <p className="setup-lede">A target and a deadline, read off numbers the game already keeps. None is a hundred years with no finish line.</p>
            <div className="start-goals">
              <button type="button" className={"start-goal" + (d.goal === null ? " start-goal-on" : "")} onClick={() => up({ goal: null })} disabled={d.sandbox}>
                <strong>None</strong><span>a hundred years, no finish line</span>
              </button>
              {GOALS.map((g) => (
                <button key={g.id} type="button" className={"start-goal" + (d.goal === g.id && !d.sandbox ? " start-goal-on" : "")} disabled={d.sandbox} onClick={() => up({ goal: g.id })}>
                  <strong>{g.label}</strong><span>{g.detail} in {g.years} years</span>
                </button>
              ))}
            </div>
            {d.sandbox && <div className="setup-warn">Sandbox runs are not scored — no goal.</div>}
          </section>

          {/* ------------------------------------------------------------ clock */}
          <section id="setup-clock" className="setup-sec">
            <h2 className="setup-h"><span className="setup-n">5</span>How the clock runs</h2>
            <p className="setup-lede">What stops Yr, Skip and Play. All of it stays on the docket either way, and all of it can be changed in Settings.</p>
            <div className="start-cols setup-cols2">
              <div className="start-col">
                <div className="start-col-head">stop for</div>
                {CLOCK_OPTIONS.map((c) => opt(d.clock === c.id, () => up({ clock: c.id }), c.label, c.note, c.id))}
              </div>
              <div className="start-col">
                <div className="start-col-head">interruptions</div>
                {d.clock !== "decisions" && <label className="setup-check">
                  <input type="checkbox" checked={d.brokerStops} onChange={(e) => up({ brokerStops: e.target.checked })} />
                  <span><strong>Broker first looks stop the clock</strong><br />
                    <span className="start-opt-note">Only for buildings you could fund at a typical 65% loan. Off, they wait on the Marketplace.</span></span>
                </label>}
                <label className="setup-check">
                  <input type="checkbox" checked={!popupsOff} onChange={(e) => setPopupsOff(!e.target.checked)} />
                  <span><strong>Pop-up cards</strong><br />
                    <span className="start-opt-note">Letters, offers, bid lists and the auction take the screen. Off, they wait on Deals. A browser preference — it applies to every campaign.</span></span>
                </label>
              </div>
            </div>
          </section>

          {/* ------------------------------------------------------------- seed */}
          <section id="setup-seed" className="setup-sec">
            <h2 className="setup-h"><span className="setup-n">6</span>Seed</h2>
            <p className="setup-lede">
              The seed deals the town — its streets, its stock, its owners. Share it to play the same map. The economy is
              not on this page and not in the seed: what money costs, where the cycle stands and which way it goes next are
              drawn fresh every game, and the market tells you as you play.
            </p>
            <div className="start-col setup-seed">
              <div className="setup-row">
                <label className="setup-label" htmlFor="setup-seed-in">Seed</label>
                <input id="setup-seed-in" className="setup-input mono" inputMode="numeric" value={seedText}
                  onChange={(e) => {
                    setSeedText(e.target.value);
                    const n = Number(e.target.value.replace(/\D/g, ""));
                    if (Number.isFinite(n) && n > 0 && n <= 0xffffffff) setD((x) => ({ ...x, seed: n >>> 0 }));
                  }} />
                <button type="button" className="setup-btn" onClick={() => up({ seed: randomSeed() })}>New seed</button>
                <button type="button" className="setup-btn" onClick={() => { try { void navigator.clipboard?.writeText(String(d.seed)); } catch { /* no clipboard */ } }}>Copy</button>
                <span className="setup-dim">{!isWritten ? <>→ the island of <strong>{islandWord}</strong></> : "on Manhattan the seed deals the stock, not the map"}</span>
              </div>
              <div className="setup-row">
                <button type="button" className="setup-btn setup-btn-strong" onClick={randomiseAll}>Randomise everything</button>
                <button type="button" className="setup-btn" onClick={() => { setD(fresh()); setCashText(""); }}>Reset to the standard game</button>
                <span className="setup-dim">Randomise draws every option above except the island and sandbox.</span>
              </div>
            </div>
          </section>

          {/* ---------------------------------------------------------- sandbox */}
          <section id="setup-sandbox" className="setup-sec setup-sandbox">
            <h2 className="setup-h"><span className="setup-n">7</span>Sandbox</h2>
            <div className={"setup-sandbox-box" + (d.sandbox ? " on" : "")}>
              <label className="setup-check">
                <input type="checkbox" checked={d.sandbox} onChange={(e) => up({ sandbox: e.target.checked, ...(e.target.checked ? { goal: null } : {}) })} />
                <span><strong>Sandbox mode — not the real game</strong><br />
                  <span className="start-opt-note setup-sandbox-note">
                    {usd(SANDBOX_CASH)} to start and no bankruptcy: the creditors never come. For trying things. The save is
                    flagged SANDBOX, and the run is kept out of your run records, goals and milestones.
                  </span></span>
              </label>
            </div>
          </section>
          {/* ------------------------------------------------------------- map */}
          <section id="setup-map" className="setup-sec">
            <h2 className="setup-h"><span className="setup-n">8</span>The map</h2>
            {isWritten ? (
              <p className="setup-lede">Manhattan's streets and lots are the real ones — the seed deals the stock, not the map.</p>
            ) : (
              <>
                <p className="setup-lede">
                  The plat this seed deals: streets, blocks, parks and every lot, coloured by what stands on it
                  (offices blue, shops orange, flats green, industry grey, vacant land tan). Not the town you want? Draw another.
                </p>
                <div className="setup-row" style={{ flexWrap: "wrap", margin: "6px 0 10px" }}>
                  <button type="button" className="setup-btn setup-btn-strong" onClick={() => up({ seed: randomSeed() })}>New map</button>
                  <span className="setup-dim">
                    {!platFresh ? "Drawing the town…"
                      : plat?.err ? `The map could not be drawn here (${plat.err}). The seed still works.`
                      : <>the island of <strong>{islandWord}</strong> · seed <span className="mono">{d.seed}</span> · {plat?.lots?.toLocaleString()} lots</>}
                  </span>
                </div>
                <div
                  className="setup-plat"
                  aria-label={`Plat map of ${islandWord}`}
                  role="img"
                  style={{
                    width: "100%", maxWidth: 900, aspectRatio: "4 / 3", borderRadius: 6, overflow: "hidden",
                    background: "#a9c8dd", border: "1px solid rgba(0,0,0,0.15)", opacity: platFresh ? 1 : 0.45,
                    transition: "opacity 0.2s", display: "flex",
                  }}
                  dangerouslySetInnerHTML={plat?.svg ? { __html: plat.svg.replace("<svg ", '<svg width="100%" height="100%" ') } : undefined}
                />
              </>
            )}
          </section>
          {loadError && <div className="start-err">{loadError}</div>}
        </div>
      </div>

      <div className="start-foot setup-foot">
        <div className="start-foot-sum">
          <span className="start-foot-town">
            {d.sandbox && <span className="setup-badge">SANDBOX</span>}
            {sizeName} · {devName} · {usd(opening)}
          </span>
          <span className="start-foot-note">
            {summary} · seed <span className="mono">{d.seed}</span>
            {" · "}build {BUILD_STAMP.commit}
          </span>
        </div>
        <div className="setup-foot-act">
          <button type="button" className="setup-btn" onClick={randomiseAll}>Randomise</button>
          <button className="start-go" disabled={phase !== "menu"} onClick={breakGround}>Break ground ▸</button>
        </div>
      </div>
    </div>
  );
}

// Lot count goes as the square of the scale. The standard island is about
// 1,420 lots measured — a preview of a decision, not a promise.
function lotsAt(k: number) {
  const n = 1420 * k * k;
  return n >= 1000 ? `${(n / 1000).toFixed(n < 3000 ? 1 : 0)}k` : `${Math.round(n / 50) * 50}`;
}
