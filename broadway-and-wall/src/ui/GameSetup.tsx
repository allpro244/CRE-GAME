import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, pendingGoal } from "@/state/store";
import { useJev } from "@/state/jevStore";
import { JevSettings } from "@/ui/panels/JevPanel";
import { CHARTERS, type CharterId } from "@/ai/jevQuestions";
import { GOALS, type GoalId } from "@/engine/goals";
import { START_CASH_CHOICES, DEFAULT_START_CASH } from "@/engine/types";
import {
  DEFAULT_SETUP, PRESETS, CREDIT_OPTIONS, FIELDS, HOME_OPTIONS, CLOCK_OPTIONS, CASH_MIN, CASH_MAX, SANDBOX_CASH,
  eraOptions, type GameSetup, type CreditChoice, type FieldChoice, type HomeChoice,
} from "@/engine/setup";
import { generateFirmName } from "@/engine/firm";
import { currentCity, currentSize, currentDev, currentCash0 } from "@/state/city";
import { cityList, cityName, sizeList, developmentList, extentList, randomSeed } from "@/citygen/index.mjs";
import { BUILD_STAMP } from "@/buildStamp";
import { usd } from "./format";

/**
 * THE GAME SETUP PAGE — which world you play in.
 *
 * Every control here is a SCENARIO, not a dial (CLAUDE.md, "DIFFICULTY IS AN
 * OUTPUT, NOT A DIAL"). The engine side is engine/setup.ts, and every option
 * names its real-world basis there. What the page adds is the reading: each
 * choice is shown with the numbers it actually opens at, so a player picks a
 * decade knowing its policy rate rather than an adjective.
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
  era: string; credit: CreditChoice; field: FieldChoice; inherit: 0 | 2 | 3 | 4; home: HomeChoice;
  firmName: string; sandbox: boolean; clock: NonNullable<GameSetup["clock"]>; brokerStops: boolean; seed: number;
}

const PRESET_KEY = "bw:setupPresets";
interface CustomPreset { name: string; draft: Omit<Draft, "seed"> & { seed?: number } }
function loadCustom(): CustomPreset[] {
  try { const v = JSON.parse(localStorage.getItem(PRESET_KEY) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function saveCustom(list: CustomPreset[]) {
  try { localStorage.setItem(PRESET_KEY, JSON.stringify(list.slice(0, 12))); } catch { /* private mode */ }
}

const SECTIONS = [
  { id: "presets", label: "Presets" },
  { id: "city", label: "City" },
  { id: "era", label: "Era & money" },
  { id: "firm", label: "Starting firm" },
  { id: "competition", label: "Competition" },
  { id: "world", label: "Historical settings" },
  { id: "goal", label: "Goal" },
  { id: "clock", label: "The clock" },
  { id: "seed", label: "Seed" },
  { id: "sandbox", label: "Sandbox" },
] as const;

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const range = (r: [number, number], f: (x: number) => string) => `${f(r[0])}–${f(r[1])}`;
const PHASE_WORD: Record<string, string> = { expansion: "expansion", peak: "peak", recession: "contraction", recovery: "trough & recovery", depression: "depression" };

export default function GameSetup({ onBack }: { onBack?: () => void }) {
  const phase = useStore((s) => s.phase);
  const startRun = useStore((s) => s.startRun);
  const popupsOff = useStore((s) => s.popupsOff);
  const setPopupsOff = useStore((s) => s.setPopupsOff);
  const loadError = useStore((s) => s.loadError);
  const j = useJev();

  const cities = cityList();
  const sizes = sizeList();
  const devs = developmentList();
  const eras = eraOptions();

  const fresh = (): Draft => {
    const island = currentCity();
    return {
      island, size: currentSize(island), dev: currentDev(island), cash0: currentCash0(), goal: null,
      era: DEFAULT_SETUP.era, credit: DEFAULT_SETUP.credit, field: DEFAULT_SETUP.field, inherit: 0, home: "any",
      firmName: "", sandbox: false, clock: "decisions", brokerStops: true, seed: randomSeed(),
    };
  };
  const [d, setD] = useState<Draft>(fresh);
  const up = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const isWritten = !!cities.find((c) => c.id === d.island)?.extents;
  const pickIsland = (id: string) => up({ island: id, size: currentSize(id), dev: currentDev(id) });

  const [custom, setCustom] = useState<CustomPreset[]>(loadCustom);
  const [presetName, setPresetName] = useState("");
  const [cashText, setCashText] = useState("");
  const [seedText, setSeedText] = useState(String(d.seed));
  useEffect(() => setSeedText(String(d.seed)), [d.seed]);
  const customCash = !START_CASH_CHOICES.includes(d.cash0 as never);

  const applyPreset = (p: Partial<GameSetup> & { cash0?: number }) => setD((x) => ({
    ...x,
    era: p.era ?? DEFAULT_SETUP.era, credit: p.credit ?? DEFAULT_SETUP.credit, field: p.field ?? DEFAULT_SETUP.field,
    inherit: p.inherit ?? 0, home: p.home ?? "any", sandbox: !!p.sandbox, cash0: p.cash0 ?? DEFAULT_START_CASH,
  }));

  const randomiseAll = () => {
    const r = Math.random;
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
    const island = d.island;
    setD({
      ...d,
      size: isWritten ? pick(extentList()).id : pick(sizes).id,
      dev: pick(devs).id,
      cash0: pick(START_CASH_CHOICES),
      era: pick(["random", ...eras.map((e) => e.key)]),
      credit: pick(CREDIT_OPTIONS).id,
      field: pick(FIELDS).id,
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
  const [active, setActive] = useState<string>("presets");
  useEffect(() => {
    const root = bodyRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((ents) => {
      const vis = ents.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (vis[0]) setActive(vis[0].target.id.replace("setup-", ""));
    }, { root, rootMargin: "0px 0px -65% 0px" });
    for (const s of SECTIONS) { const el = document.getElementById(`setup-${s.id}`); if (el) io.observe(el); }
    return () => io.disconnect();
  }, []);
  const go = (id: string) => document.getElementById(`setup-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const eraSel = eras.find((e) => e.key === d.era);
  const islandWord = cityName(d.island, d.seed) || cities.find((c) => c.id === d.island)?.name || "the island";
  const firmPlaceholder = generateFirmName(d.seed).name;
  const sizeName = isWritten ? extentList().find((e) => e.id === d.size)?.name : sizes.find((s) => s.id === d.size)?.name;
  const devName = devs.find((x) => x.id === d.dev)?.name;
  const opening = d.sandbox ? SANDBOX_CASH : d.cash0;

  const summary = useMemo(() => {
    const bits = [
      eraSel ? eraSel.label : "a seeded era",
      d.credit !== "drawn" ? (d.credit === "loose" ? "easing credit" : "tightening credit") : null,
      d.field !== "standard" ? "before the opportunity funds" : null,
      d.inherit ? `${d.inherit} family buildings` : null,
    ].filter(Boolean);
    return bits.join(" · ");
  }, [eraSel, d.credit, d.field, d.inherit]);

  const breakGround = () => {
    pendingGoal.id = d.sandbox ? null : d.goal;
    const setup: Partial<GameSetup> = {
      era: d.era, credit: d.credit, field: d.field, inherit: d.inherit, home: d.home,
      firmName: d.firmName.trim() || undefined, sandbox: d.sandbox, clock: d.clock,
      brokerStops: d.brokerStops ? undefined : "never", jevFirms: j.startFirms, spectator: j.startSpectator,
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
              Which world you play in. Nothing on this page is a difficulty setting — every choice is a position the
              market has actually opened from, and the defaults are the standard game.
            </div>
          </div>
          {onBack && <button type="button" className="setup-back" onClick={onBack}>◂ Back</button>}
        </div>
      </div>

      <div className="setup-frame">
        <nav className="setup-rail" aria-label="Setup sections">
          {SECTIONS.map((s, i) => (
            <button key={s.id} type="button" className={"setup-rail-item" + (active === s.id ? " on" : "")} onClick={() => go(s.id)}>
              <span className="setup-rail-n">{i === 0 ? "★" : i}</span>{s.label}
            </button>
          ))}
        </nav>

        <div className="start-body setup-body" ref={bodyRef}>
          {/* ---------------------------------------------------------- presets */}
          <section id="setup-presets" className="setup-sec">
            <h2 className="setup-h">Presets</h2>
            <p className="setup-lede">Named scenarios, each built only from the options below. Pick one and adjust, or save your own.</p>
            <div className="setup-cards">
              {PRESETS.map((p) => (
                <button key={p.id} type="button" className="setup-card" onClick={() => applyPreset(p.setup)}>
                  <strong>{p.label}</strong><span>{p.note}</span>
                </button>
              ))}
            </div>
            <div className="setup-row setup-custom">
              <span className="setup-label">Your presets</span>
              {custom.length === 0 && <span className="setup-dim">None saved yet.</span>}
              {custom.map((c, i) => (
                <span key={c.name + i} className="setup-chip">
                  <button type="button" onClick={() => setD((x) => ({ ...x, ...c.draft, seed: c.draft.seed ?? x.seed }))}>{c.name}</button>
                  <button type="button" aria-label={`Delete preset ${c.name}`} className="setup-chip-x"
                    onClick={() => { const n = custom.filter((_, k) => k !== i); setCustom(n); saveCustom(n); }}>×</button>
                </span>
              ))}
              <input className="setup-input" placeholder="Name this setup" value={presetName} maxLength={40}
                onChange={(e) => setPresetName(e.target.value)} aria-label="Preset name" />
              <button type="button" className="setup-btn" disabled={!presetName.trim()}
                onClick={() => {
                  const n = [...custom.filter((c) => c.name !== presetName.trim()), { name: presetName.trim(), draft: { ...d } }];
                  setCustom(n); saveCustom(n); setPresetName("");
                }}>Save current</button>
            </div>
          </section>

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
          </section>

          {/* -------------------------------------------------------------- era */}
          <section id="setup-era" className="setup-sec">
            <h2 className="setup-h"><span className="setup-n">2</span>Starting era &amp; monetary regime</h2>
            <p className="setup-lede">
              The five positions the American property market has actually opened from (regime.ts). Each sets what money
              costs, what inflation is doing, how much space is empty and where in the cycle the city stands — together,
              because they move together. The cycle phase follows the era: a 14% policy rate does not coexist with an expansion.
            </p>
            <div className="setup-cards setup-eras">
              <button type="button" className={"setup-card" + (d.era === "random" ? " on" : "")} aria-pressed={d.era === "random"} onClick={() => up({ era: "random" })}>
                <strong>Drawn from the seed</strong>
                <span>The standard game: weighted by how much of the last century each era describes — 30% a long expansion, 26% a disinflation, 20% after a crash, 13% inflation, 11% the morning after.</span>
              </button>
              {eras.map((e) => (
                <button key={e.key} type="button" className={"setup-card" + (d.era === e.key ? " on" : "")} aria-pressed={d.era === e.key} onClick={() => up({ era: e.key })}>
                  <strong>{e.label}</strong>
                  <span>{e.blurb}</span>
                  <span className="setup-facts mono">
                    policy {range(e.policy, (x) => x.toFixed(1) + "%")} · inflation {range(e.infl, (x) => pct(x))}<br />
                    credit window {range(e.creditIdx, (x) => Math.round(x * 100) + "%")} open · opens in {PHASE_WORD[e.phase] ?? e.phase}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* ------------------------------------------------------------- firm */}
          <section id="setup-firm" className="setup-sec">
            <h2 className="setup-h"><span className="setup-n">3</span>Starting firm</h2>
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
              </div>
              <div className="start-col">
                <div className="start-col-head">the opening book</div>
                {opt(d.inherit === 0, () => up({ inherit: 0 }), "Start from nothing", "Cash and a desk. Every deed on the book is one you bought or built.", "inh0")}
                {([2, 3, 4] as const).map((n) => opt(d.inherit === n, () => up({ inherit: n }), `Inherit ${n} family buildings`,
                  "Small buildings ($0.6–3.5M) from the town's own stock, with their real rent rolls and fresh hometown-bank paper at 35% — family leverage. They come in kind, at the appraiser's number; no cash changes hands.", `inh${n}`))}
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
            <h2 className="setup-h"><span className="setup-n">4</span>Competition</h2>
            <p className="setup-lede">
              Which generation of capital owns the town on day one. How MANY firms the town supports is an output, not a
              setting: funds are raised in good years and fail in bad ones, and the roster is sized to the map.
            </p>
            <div className="start-cols setup-cols2">
              <div className="start-col">
                <div className="start-col-head">the incumbents</div>
                {FIELDS.map((f) => opt(d.field === f.id, () => up({ field: f.id }), f.label, f.note, f.id))}
              </div>
              <div className="start-col">
                <div className="start-col-head">firms run by Jev</div>
                <div className="setup-row">
                  <label className="setup-label">Jev runs
                    <select className="setup-input" value={j.startFirms} aria-label="How many firms Jev runs"
                      onChange={(e) => j.set({ startFirms: Number(e.target.value), ...(Number(e.target.value) ? {} : { startSpectator: false }) })}>
                      {[0, 1, 2, 3, 4, 6, 8, 12].map((k) => <option key={k} value={k}>{k === 0 ? "no" : k}</option>)}
                    </select> rival firm{j.startFirms === 1 ? "" : "s"}
                  </label>
                  {j.startFirms > 0 && (
                    <label className="setup-label">as
                      <select className="setup-input" value={j.startCharter} aria-label="Charter"
                        onChange={(e) => j.set({ startCharter: e.target.value as CharterId | "style" })}>
                        <option value="style">their own styles</option>
                        {(Object.keys(CHARTERS) as CharterId[]).map((c) => <option key={c} value={c}>{CHARTERS[c].label}s</option>)}
                      </select>
                    </label>
                  )}
                </div>
                <label className="setup-check">
                  <input type="checkbox" checked={j.startSpectator} disabled={!j.startFirms}
                    onChange={(e) => j.set({ startSpectator: e.target.checked })} />
                  Spectator: no player — watch the firms compete
                </label>
                <details className="setup-details">
                  <summary>Set up Jev — TypeSafe key and route</summary>
                  <div className="setup-jev"><JevSettings /></div>
                </details>
              </div>
            </div>
          </section>

          {/* ------------------------------------------------------------ world */}
          <section id="setup-world" className="setup-sec">
            <h2 className="setup-h"><span className="setup-n">5</span>Historical settings</h2>
            <p className="setup-lede">Not difficulty: each is a real position inside the era you chose.</p>
            <div className="start-cols setup-cols2">
              <div className="start-col">
                <div className="start-col-head">opening credit climate</div>
                {CREDIT_OPTIONS.map((c) => opt(d.credit === c.id, () => up({ credit: c.id }), c.label,
                  <>{c.note}{eraSel && c.id !== "drawn" ? ` In ${eraSel.label.toLowerCase()}: the window opens ${Math.round((c.id === "loose" ? eraSel.creditIdx[1] : eraSel.creditIdx[0]) * 100)}% open.` : ""}</>, c.id))}
                <div className="start-opt-note" style={{ padding: "6px 9px" }}>
                  In the two crunch eras the desks are shut at both ends of the band — tightening shows up as a dearer
                  loan, not a smaller one. In a long expansion it moves the advance itself.
                </div>
              </div>
              <div className="start-col">
                <div className="start-col-head">fixed at their historical rates</div>
                <div className="setup-fixed">
                  <strong>Shocks</strong>
                  <span>Level events — a trade leaving town, a use class restructured — arrive at the rates counted off the real
                    record: a trade event about once in 22 years, a use-class event once in 30. Some careers see one, some nine.
                    That spread is the draw; turning the rate down would be a dial, so it is not offered.</span>
                </div>
                <div className="setup-fixed">
                  <strong>Zoning</strong>
                  <span>The city rezones districts on its own reading of scarcity, and you can file for a variance. There is one
                    planning process in the engine, not a permissive and a restrictive one to choose between.</span>
                </div>
              </div>
            </div>
          </section>

          {/* ------------------------------------------------------------- goal */}
          <section id="setup-goal" className="setup-sec">
            <h2 className="setup-h"><span className="setup-n">6</span>Goal</h2>
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
            <h2 className="setup-h"><span className="setup-n">7</span>How the clock runs</h2>
            <p className="setup-lede">What stops Yr, Skip and Play. All of it stays on the docket either way, and all of it can be changed in Settings.</p>
            <div className="start-cols setup-cols2">
              <div className="start-col">
                <div className="start-col-head">stop for</div>
                {CLOCK_OPTIONS.map((c) => opt(d.clock === c.id, () => up({ clock: c.id }), c.label, c.note, c.id))}
              </div>
              <div className="start-col">
                <div className="start-col-head">interruptions</div>
                <label className="setup-check">
                  <input type="checkbox" checked={d.brokerStops} onChange={(e) => up({ brokerStops: e.target.checked })} />
                  <span><strong>Broker first looks stop the clock</strong><br />
                    <span className="start-opt-note">Only for buildings you could fund at a typical 65% loan. Off, they wait on the Marketplace.</span></span>
                </label>
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
            <h2 className="setup-h"><span className="setup-n">8</span>Seed</h2>
            <p className="setup-lede">
              The seed deals the town and every draw after it. The same seed with the same choices is the same world —
              share it, or replay it.
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
            <h2 className="setup-h"><span className="setup-n">9</span>Sandbox</h2>
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
