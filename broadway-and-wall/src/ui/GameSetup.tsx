import { useEffect, useMemo, useState } from "react";
import { useStore, pendingGoal } from "@/state/store";
import { GOALS, type GoalId } from "@/engine/goals";
import { START_CASH_CHOICES } from "@/engine/types";
import { competitorOpeningRange } from "@/engine/rivals";
import {
  DEFAULT_SETUP, FIELDS, HOME_OPTIONS, RIVAL_CAPITAL, CLOCK_OPTIONS, CASH_MIN, CASH_MAX, SANDBOX_CASH,
  type GameSetup, type FieldChoice, type HomeChoice, type RivalCapital,
} from "@/engine/setup";
import { generateFirmName } from "@/engine/firm";
import { setupCity, currentSize, currentDev, currentCash0, regionShown } from "@/state/city";
import { cityList, cityName, sizeList, developmentList, extentList, randomSeed, PARK_AMOUNTS, REGION } from "@/citygen/index.mjs";
import { drawPlatOffThread } from "@/state/platClient";
import { BUILD_STAMP } from "@/buildStamp";
import { usd } from "./format";

/**
 * THE GAME SETUP PAGE — which world you play in (revamped 2026-10-22).
 *
 * One dense screen: the map first (the region leads, one line on each), then
 * the firm, the competition, the goal, the clock and the seed, each a row of
 * choices with the chosen one's note under it; the rest (build-out, parks,
 * the market's rules, interruptions, the firm's name) folds under Advanced.
 * The town this seed deals is drawn beside it. Break ground is always in the
 * footer.
 *
 * Every control is about the player and the town, never the economy, and
 * never a dial (CLAUDE.md, "DIFFICULTY IS AN OUTPUT, NOT A DIAL"). The economy
 * is simulated before month one (engine/regime.ts) and is met on the tape.
 *
 * The defaults are the standard game exactly — test/setup.mjs holds that with
 * a state hash — so a player who presses Break ground without touching
 * anything plays the game everybody else plays.
 */

const CASH_NOTE: Record<number, string> = {
  1_000_000: "One small building outright, or two with debt, and almost no reserve.",
  2_500_000: "The standard opening. Room for a couple of buildings and a reserve to carry a lease-up.",
  5_000_000: "A real first book. Enough to be wrong once and still be in business.",
  10_000_000: "A small institutional platform: a diversified first book.",
  20_000_000: "A serious acquisition book from the first month.",
};

/** One line per map, for the picker. The long taglines stay in citygen for the places that quote them. */
const MAP_LINE: Record<string, { line: string; tag?: string }> = {
  [REGION]: { line: "A river city and 6 km of country: towns, farms, highway. Buy land, plat lots, build.", tag: "New" },
  procedural: { line: "A generated island. Coast, districts and streets come from your seed." },
  manhattan: { line: "The real island, lot for lot, from the city's own records." },
};

const BOOK = [
  { n: 0 as const, label: "None", note: "Cash and a desk. Every deed on the book is one you bought or built." },
  { n: 2 as const, label: "2 buildings", note: "A corner shop and a walk-up from the family, at 35% hometown-bank leverage." },
  { n: 3 as const, label: "3 buildings", note: "A small family book, in kind at the appraiser's number, 35% leverage." },
  { n: 4 as const, label: "4 buildings", note: "Most of what a family accumulates in a generation, 35% leverage." },
];

interface Draft {
  island: string; size: string; dev: string; cash0: number; goal: GoalId | null;
  field: FieldChoice; inherit: 0 | 2 | 3 | 4; home: HomeChoice; rivalCapital: RivalCapital;
  parks: "low" | "medium" | "high";
  firmName: string; sandbox: boolean; clock: NonNullable<GameSetup["clock"]>; brokerStops: boolean; seed: number; poolEntry: boolean; rivalReputation: boolean; rivalDealTerms: boolean; builderFirms: boolean;
}

export default function GameSetup({ onBack }: { onBack?: () => void }) {
  const phase = useStore((s) => s.phase);
  const startRun = useStore((s) => s.startRun);
  const popupsOff = useStore((s) => s.popupsOff);
  const setPopupsOff = useStore((s) => s.setPopupsOff);
  const loadError = useStore((s) => s.loadError);

  // the island leads; the region map is hidden unless a developer asks for it (`?maps=all`, state/city.ts regionShown)
  const cities = cityList().filter((c) => c.id !== REGION || regionShown());
  const sizes = sizeList();
  const devs = developmentList();

  const fresh = (): Draft => {
    const island = setupCity();
    return {
      island, size: currentSize(island), dev: currentDev(island), cash0: currentCash0(), goal: null,
      field: DEFAULT_SETUP.field, inherit: 0, home: "any", rivalCapital: "medium", parks: "medium",
      firmName: "", sandbox: false, clock: "decisions", brokerStops: true, seed: randomSeed(), poolEntry: true, rivalReputation: true, rivalDealTerms: true, builderFirms: true,
    };
  };
  const [d, setD] = useState<Draft>(fresh);
  const up = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const isWritten = !!cities.find((c) => c.id === d.island)?.extents;
  // the region map is one fixed 6 km window: no size to choose, no park amount (its greens are its own)
  const isFixed = !!cities.find((c) => c.id === d.island)?.fixedSize;
  const fixedOf = (id: string) => !!cities.find((c) => c.id === id)?.fixedSize;
  const pickIsland = (id: string) => up({ island: id, size: fixedOf(id) ? id : currentSize(id), dev: currentDev(id) });
  const [adv, setAdv] = useState(false);

  const [cashText, setCashText] = useState("");
  const [seedText, setSeedText] = useState(String(d.seed));
  useEffect(() => setSeedText(String(d.seed)), [d.seed]);

  // THE SEED'S MAP. Drawn off the page's thread whenever anything that shapes
  // the town changes, after a short pause. Same makeCity call Break ground
  // makes, so this is the town you will get.
  const [plat, setPlat] = useState<{ key: string; svg?: string; lots?: number; err?: string } | null>(null);
  const platKey = `${d.island}|${d.size}|${d.dev}|${d.parks}|${d.seed}`;
  useEffect(() => {
    if (isWritten) return;
    let gone = false;
    const t = setTimeout(() => {
      void drawPlatOffThread({ island: d.island, seed: d.seed, size: isFixed ? d.island : d.size, dev: d.dev, parks: d.parks === "medium" ? undefined : d.parks })
        .then((r) => { if (!gone) setPlat({ key: platKey, svg: r.svg, lots: r.lots, err: r.err }); });
    }, 250);
    return () => { gone = true; clearTimeout(t); };
  }, [platKey, isWritten]);
  const platFresh = plat?.key === platKey;
  const customCash = !START_CASH_CHOICES.includes(d.cash0 as never);

  const randomiseAll = () => {
    const r = Math.random;
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
    setD({
      ...d,
      size: isFixed ? d.island : isWritten ? pick(extentList()).id : pick(sizes).id,
      dev: pick(devs).id,
      cash0: pick(START_CASH_CHOICES),
      field: pick(FIELDS).id,
      rivalCapital: pick(RIVAL_CAPITAL).id,
      parks: pick(PARK_AMOUNTS).id,
      inherit: pick([0, 0, 2, 3, 4] as const),
      home: pick(HOME_OPTIONS).id,
      goal: pick([null, ...GOALS.map((g) => g.id)]),
      seed: randomSeed(),
      sandbox: false,
    });
  };

  const islandWord = cityName(d.island, d.seed) || cities.find((c) => c.id === d.island)?.name || "the island";
  const firmPlaceholder = generateFirmName(d.seed).name;
  const sizeName = isFixed ? "6 km region" : isWritten ? extentList().find((e) => e.id === d.size)?.name : sizes.find((s) => s.id === d.size)?.name;
  const devName = devs.find((x) => x.id === d.dev)?.name;
  const opening = d.sandbox ? SANDBOX_CASH : d.cash0;
  const cr = competitorOpeningRange(d.size, d.field, d.rivalCapital);
  const rank = cr.rankOf(opening);

  const summary = useMemo(() => [
    d.field !== "standard" ? "before the opportunity funds" : null,
    d.inherit ? `${d.inherit} family buildings` : null,
    d.rivalCapital !== "medium" ? `rivals' money ${RIVAL_CAPITAL.find((c) => c.id === d.rivalCapital)?.label.toLowerCase()}` : null,
    d.goal ? GOALS.find((g) => g.id === d.goal)?.label : null,
    d.parks !== "medium" && !isWritten && !isFixed ? `${PARK_AMOUNTS.find((x) => x.id === d.parks)?.name.toLowerCase()} parks` : null,
  ].filter(Boolean).join(" · "), [d.field, d.inherit, d.rivalCapital, d.goal, d.parks, isWritten, isFixed]);

  const breakGround = () => {
    pendingGoal.id = d.sandbox ? null : d.goal;
    const setup: Partial<GameSetup> = {
      field: d.field, inherit: d.inherit, home: d.home,
      rivalCapital: d.rivalCapital === "medium" ? undefined : d.rivalCapital,
      // a written-down city's parks are real: the choice only applies to a generated island
      parks: d.parks === "medium" || isWritten || isFixed ? undefined : d.parks,
      firmName: d.firmName.trim() || undefined, sandbox: d.sandbox, clock: d.clock,
      brokerStops: d.brokerStops ? undefined : "never",
      poolEntry: d.poolEntry ? undefined : false,
      rivalReputation: d.rivalReputation ? undefined : false,
      rivalDealTerms: d.rivalDealTerms ? undefined : false,
      builderFirms: d.builderFirms ? undefined : false,
    };
    void startRun(d.island, isFixed ? d.island : d.size, d.dev, d.cash0, setup, d.seed);
  };

  /** A row of choices: one segmented control, the chosen one's note beneath. */
  const seg = <T extends string | number | null>(items: { id: T; label: string; note?: string; disabled?: boolean }[], on: T, set: (v: T) => void, label: string) => (
    <div className="hs-seg" role="radiogroup" aria-label={label}>
      {items.map((it) => (
        <button key={String(it.id)} type="button" role="radio" aria-checked={it.id === on} disabled={it.disabled}
          className={"hs-seg-btn" + (it.id === on ? " on" : "")} title={it.note} onClick={() => set(it.id)}>{it.label}</button>
      ))}
    </div>
  );
  const check = (on: boolean, set: (v: boolean) => void, name: string, note: string) => (
    <label className="hs-check">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      <span><b>{name}</b> <span className="hs-note">{note}</span></span>
    </label>
  );
  const nth = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;

  return (
    <div className="start setup hs">
      <div className="hs-head">
        <div>
          <div className="hs-kicker">New game</div>
          <div className="start-title">Setup</div>
        </div>
        {onBack && <button type="button" className="setup-back" onClick={onBack}>◂ Back</button>}
      </div>

      <div className="hs-frame">
        <div className="hs-form">
          {/* ------------------------------------------------------------ map */}
          <div className="hs-row hs-row-map">
            <div className="hs-label">Map</div>
            <div className="hs-maps">
              {cities.map((c) => (
                <button key={c.id} type="button" className={"hs-map" + (c.id === d.island ? " on" : "")} aria-pressed={c.id === d.island} onClick={() => pickIsland(c.id)}>
                  <span className="hs-map-name">{c.name}</span>
                  {MAP_LINE[c.id]?.tag && <span className="hs-map-tag">{MAP_LINE[c.id]!.tag}</span>}
                  <span className="hs-map-line">{MAP_LINE[c.id]?.line ?? c.tagline}</span>
                </button>
              ))}
            </div>
          </div>
          {isWritten && (
            <div className="hs-row">
              <div className="hs-label">Uptown to</div>
              <div>
                {seg(extentList().map((e) => ({ id: e.id, label: e.name, note: e.note })), d.size, (v) => up({ size: v }), "How far uptown")}
                <div className="hs-note">{extentList().find((e) => e.id === d.size)?.note}</div>
              </div>
            </div>
          )}
          {!isWritten && !isFixed && (
            <div className="hs-row">
              <div className="hs-label">Size</div>
              <div>
                {seg(sizes.map((s) => ({ id: s.id, label: `${s.name} · ${lotsAt(s.k)}`, note: s.note })), d.size, (v) => up({ size: v }), "How big")}
                <div className="hs-note">{sizes.find((s) => s.id === d.size)?.note}</div>
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------ firm */}
          <div className="hs-row">
            <div className="hs-label">Capital</div>
            <div>
              <div className="hs-inline">
                {seg(START_CASH_CHOICES.map((v) => ({ id: v, label: usd(v), note: CASH_NOTE[v], disabled: d.sandbox })), customCash || d.sandbox ? -1 : d.cash0, (v) => { up({ cash0: v }); setCashText(""); }, "Opening capital")}
                <input id="setup-cash" className={"hs-input mono" + (customCash ? " on" : "")} inputMode="decimal" disabled={d.sandbox}
                  placeholder={`$${CASH_MIN / 1e6}–${CASH_MAX / 1e6}M`} aria-label="Custom capital in $M"
                  value={cashText} onChange={(e) => {
                    setCashText(e.target.value);
                    const m = Number(e.target.value.replace(/[$,m\s]/gi, ""));
                    if (Number.isFinite(m) && m > 0) up({ cash0: Math.round(Math.max(CASH_MIN, Math.min(CASH_MAX, m * 1e6)) / 50_000) * 50_000 });
                  }} />
              </div>
              <div className="hs-note">
                {d.sandbox ? `Sandbox: ${usd(SANDBOX_CASH)}.` : CASH_NOTE[d.cash0] ?? `${usd(d.cash0)}.`}
                {" "}Opens about <b>{nth(rank)} of {cr.firms + 1}</b>; rivals bring {usd(cr.lo)}–{usd(cr.hi)}.
              </div>
            </div>
          </div>
          <div className="hs-row">
            <div className="hs-label">Family book</div>
            <div>
              {seg(BOOK.map((b) => ({ id: b.n, label: b.label, note: b.note })), d.inherit, (v) => up({ inherit: v }), "Inherited buildings")}
              <div className="hs-note">{BOOK.find((b) => b.n === d.inherit)?.note}</div>
            </div>
          </div>

          {/* ----------------------------------------------------- competition */}
          <div className="hs-row">
            <div className="hs-label">Rivals</div>
            <div>
              <div className="hs-inline">
                {seg(FIELDS.map((f) => ({ id: f.id, label: f.label, note: f.note })), d.field, (v) => up({ field: v }), "The incumbents")}
                {seg(RIVAL_CAPITAL.map((c) => ({ id: c.id, label: c.label, note: c.note })), d.rivalCapital, (v) => up({ rivalCapital: v }), "Their money")}
              </div>
              <div className="hs-note">{FIELDS.find((f) => f.id === d.field)?.note} {RIVAL_CAPITAL.find((c) => c.id === d.rivalCapital)?.note}</div>
            </div>
          </div>

          {/* ------------------------------------------------------------ goal */}
          <div className="hs-row">
            <div className="hs-label">Goal</div>
            <div>
              {seg([{ id: null as GoalId | null, label: "None", note: "A hundred years, no finish line" }, ...GOALS.map((g) => ({ id: g.id as GoalId | null, label: `${g.label} · ${g.years}y`, note: g.detail, disabled: d.sandbox }))],
                d.sandbox ? null : d.goal, (v) => up({ goal: v }), "Goal")}
              <div className="hs-note">{d.sandbox ? "Sandbox runs are not scored." : d.goal ? `${GOALS.find((g) => g.id === d.goal)?.detail} in ${GOALS.find((g) => g.id === d.goal)?.years} years.` : "A hundred years, no finish line."}</div>
            </div>
          </div>

          {/* ----------------------------------------------------------- clock */}
          <div className="hs-row">
            <div className="hs-label">Clock stops</div>
            <div>
              {seg(CLOCK_OPTIONS.map((c) => ({ id: c.id, label: c.label, note: c.note })), d.clock, (v) => up({ clock: v }), "What stops the clock")}
              <div className="hs-note">{CLOCK_OPTIONS.find((c) => c.id === d.clock)?.note.split(" — ")[0].split(". ")[0]}.</div>
            </div>
          </div>

          {/* ------------------------------------------------------------ seed */}
          <div className="hs-row">
            <div className="hs-label">Seed</div>
            <div className="hs-inline">
              <input id="setup-seed-in" className="hs-input mono" inputMode="numeric" value={seedText} aria-label="Seed"
                onChange={(e) => {
                  setSeedText(e.target.value);
                  const n = Number(e.target.value.replace(/\D/g, ""));
                  if (Number.isFinite(n) && n > 0 && n <= 0xffffffff) setD((x) => ({ ...x, seed: n >>> 0 }));
                }} />
              <button type="button" className="hs-btn" onClick={() => up({ seed: randomSeed() })}>New</button>
              <button type="button" className="hs-btn" onClick={() => { try { void navigator.clipboard?.writeText(String(d.seed)); } catch { /* no clipboard */ } }}>Copy</button>
              <label className="hs-check hs-sandbox">
                <input type="checkbox" checked={d.sandbox} onChange={(e) => up({ sandbox: e.target.checked, ...(e.target.checked ? { goal: null } : {}) })} />
                <span><b>Sandbox</b> <span className="hs-note">{usd(SANDBOX_CASH)}, no bankruptcy, unscored</span></span>
              </label>
            </div>
          </div>

          {/* -------------------------------------------------------- advanced */}
          <button type="button" className="hs-adv-toggle" aria-expanded={adv} onClick={() => setAdv(!adv)}>{adv ? "▾" : "▸"} Advanced</button>
          {adv && (
            <div className="hs-adv">
              <div className="hs-row">
                <div className="hs-label">Built up</div>
                <div>
                  {seg(devs.map((x) => ({ id: x.id, label: x.name, note: x.note })), d.dev, (v) => up({ dev: v }), "How built up")}
                  <div className="hs-note">{devs.find((x) => x.id === d.dev)?.note}</div>
                </div>
              </div>
              {!isWritten && !isFixed && (
                <div className="hs-row">
                  <div className="hs-label">Parks</div>
                  <div>
                    {seg(PARK_AMOUNTS.map((x) => ({ id: x.id, label: x.name, note: x.note })), d.parks, (v) => up({ parks: v }), "How many parks")}
                    <div className="hs-note">{PARK_AMOUNTS.find((x) => x.id === d.parks)?.note}</div>
                  </div>
                </div>
              )}
              <div className="hs-row">
                <div className="hs-label">Firm name</div>
                <div className="hs-inline">
                  <input className="hs-input hs-input-wide" placeholder={firmPlaceholder} value={d.firmName} maxLength={48}
                    aria-label="Firm name" onChange={(e) => up({ firmName: e.target.value })} />
                </div>
              </div>
              <div className="hs-row">
                <div className="hs-label">Family bought</div>
                <div>
                  {seg(HOME_OPTIONS.map((h) => ({ id: h.id, label: h.label, note: h.note, disabled: !d.inherit })), d.home, (v) => up({ home: v }), "Where the family's buildings are")}
                  <div className="hs-note">{d.inherit ? HOME_OPTIONS.find((h) => h.id === d.home)?.note : "Only with a family book."}</div>
                </div>
              </div>
              <div className="hs-row">
                <div className="hs-label">Market rules</div>
                <div className="hs-checks">
                  {check(d.poolEntry, (v) => up({ poolEntry: v }), "One capital market", "new firms raise from the same yearly investor pool you do")}
                  {check(d.rivalReputation, (v) => up({ rivalReputation: v }), "Rivals raise on their record", "spin-outs carry their old firm's record")}
                  {check(d.builderFirms, (v) => up({ builderFirms: v }), "Every builder is a firm", "developers own, borrow, sell and can fail")}
                  {check(d.rivalDealTerms, (v) => up({ rivalDealTerms: v }), "Builders raise each job on their record", "an unknown builder raises 1:1, a top one 9:1")}
                </div>
              </div>
              <div className="hs-row">
                <div className="hs-label">Interruptions</div>
                <div className="hs-checks">
                  {d.clock !== "decisions" && check(d.brokerStops, (v) => up({ brokerStops: v }), "Broker first looks stop the clock", "only for buildings you could fund")}
                  {check(!popupsOff, (v) => setPopupsOff(!v), "Pop-up cards", "letters and offers take the screen; a browser setting")}
                </div>
              </div>
              <div className="hs-row">
                <div className="hs-label" />
                <div className="hs-inline">
                  <button type="button" className="hs-btn" onClick={randomiseAll}>Randomise all</button>
                  <button type="button" className="hs-btn" onClick={() => { setD(fresh()); setCashText(""); }}>Standard game</button>
                </div>
              </div>
            </div>
          )}
          {loadError && <div className="start-err">{loadError}</div>}
        </div>

        {/* --------------------------------------------------------- the town */}
        <aside className="hs-town">
          {isWritten ? (
            <div className="hs-town-written">Manhattan's streets and lots are the real ones. The seed deals the stock, not the map.</div>
          ) : (
            <>
              <div
                className="hs-plat"
                aria-label={`Plat map of ${islandWord}`}
                role="img"
                style={{ opacity: platFresh ? 1 : 0.45 }}
                dangerouslySetInnerHTML={plat?.svg ? { __html: plat.svg.replace("<svg ", '<svg width="100%" height="100%" ') } : undefined}
              />
              <div className="hs-town-cap">
                <span className="hs-town-name">{islandWord}</span>
                <span className="mono hs-note">{!platFresh ? "drawing…" : plat?.err ? "map unavailable" : `${plat?.lots?.toLocaleString()} lots · seed ${d.seed}`}</span>
                <button type="button" className="hs-btn" onClick={() => up({ seed: randomSeed() })}>New map</button>
              </div>
            </>
          )}
        </aside>
      </div>

      <div className="start-foot setup-foot hs-foot">
        <div className="start-foot-sum">
          <span className="start-foot-town">
            {d.sandbox && <span className="setup-badge">SANDBOX</span>}
            {isFixed ? cities.find((c) => c.id === d.island)?.name : `${cities.find((c) => c.id === d.island)?.name} · ${sizeName}`} · {devName} · {usd(opening)}
          </span>
          <span className="start-foot-note">
            {summary ? summary + " · " : ""}seed <span className="mono">{d.seed}</span>{" · "}build {BUILD_STAMP.commit}
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
  return n >= 1000 ? `${(n / 1000).toFixed(n < 3000 ? 1 : 0)}k lots` : `${Math.round(n / 50) * 50} lots`;
}
