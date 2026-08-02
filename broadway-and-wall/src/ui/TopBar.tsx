import { useEffect, useRef, useState } from "react";
import { useStore, derivedNetWorth, derivedQuarterCF } from "@/state/store";
import { monthLabel } from "@/engine/types";
import { currentCity, listCities, switchCity, type CityInfo } from "@/state/city";
import { usd, pct } from "./format";

export default function TopBar() {
  const [armNewRun, setArmNewRun] = useState(false);
  const fps = useStore((s) => s.fps);
  const manifest = useStore((s) => s.manifest);
  const game = useStore((s) => s.game);
  const lens = useStore((s) => s.lens);
  const setLens = useStore((s) => s.setLens);
  const advance = useStore((s) => s.advance);
  const advanceYear = useStore((s) => s.advanceYear);
  const advanceUntil = useStore((s) => s.advanceUntil);
  const page = useStore((s) => s.page);
  const setPage = useStore((s) => s.setPage);
  const nw = derivedNetWorth();
  const cf = derivedQuarterCF();
  const dealsCount = game ? game.lois.length + Object.values(game.holdings).filter((h) => h.sale?.offer).length : 0;

  // The city menu. Six towns ship side by side; each keeps its own autosave,
  // so this is a switch between campaigns, not a reset of one.
  const [cities, setCities] = useState<CityInfo[]>([]);
  const [cityOpen, setCityOpen] = useState(false);
  const cityRef = useRef<HTMLDivElement>(null);
  useEffect(() => { void listCities().then(setCities); }, []);
  useEffect(() => {
    if (!cityOpen) return;
    const close = (e: MouseEvent) => {
      if (cityRef.current && !cityRef.current.contains(e.target as Node)) setCityOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [cityOpen]);

  return (
    <div className="topbar">
      <div className="brand">
        <span className="brand-name">Broadway &amp; Wall</span>
        {cities.length > 1 ? (
          <div className="city-pick" ref={cityRef}>
            <button
              className="brand-sub city-pick-btn"
              title="Switch city — each city keeps its own campaign and autosave"
              onClick={() => setCityOpen((v) => !v)}
            >
              {manifest?.city ?? currentCity()} ▾
            </button>
            {cityOpen && (
              <div className="city-menu">
                {cities.map((c) => (
                  <button
                    key={c.id}
                    className={"city-item" + (c.id === currentCity() ? " city-item-on" : "")}
                    onClick={() => { if (c.id !== currentCity()) switchCity(c.id); else setCityOpen(false); }}
                  >
                    <span className="city-item-name">{c.name}</span>
                    <span className="city-item-tag">{c.tagline}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <span className="brand-sub">
            {manifest?.city ?? (manifest?.district === "MN" ? "Manhattan" : "Lower Manhattan · CD 1")}
          </span>
        )}
        {manifest?.source === "synthetic" && (
          <span className="badge badge-warn" title="Generated stand-in data — run `pnpm pipeline` on an open network to fetch real PLUTO data.">
            SYNTHETIC DEV DATA
          </span>
        )}
      </div>

      {game && (
        <div className="topbar-game">
          <Stat label={monthLabel(game.month)} value={`Yr ${Math.floor(game.month / 12) + 1}`} wide />
          <Stat label="Cash" value={usd(game.cash)} bad={game.cash < 0} />
          <Stat label="Net worth" value={usd(nw)} drop={2} />
          <Stat label="CF / mo" value={usd(cf)} bad={cf < 0} drop={2} />
          <Stat label="Index" value={pct(game.econ.indexRate)} drop={3} />
          {(game.loc?.balance ?? 0) > 0 && <Stat label="Line drawn" value={usd(game.loc.balance)} bad />}
          <Stat label="Market" value={game.econ.phase} drop={3} />
          <Stat
            drop={3}
            label="Vacant lots"
            value={String(Math.max(0, game.totalLots - game.builtAtStart - Object.keys(game.built).length))}
            title={`Empty lots left in ${manifest?.city ?? "town"}. Every one is a site someone can build on — as they run out, land gets scarce and prices climb. ${game.totalLots ? Math.round((100 * (game.builtAtStart + Object.keys(game.built).length)) / game.totalLots) : 0}% of the city is built.`}
          />
          <span className="topbar-sep" />
          <button className={"nav-btn" + (page === "portfolio" ? " nav-on" : "")} onClick={() => setPage(page === "portfolio" ? "none" : "portfolio")}>
            Portfolio
          </button>
          <button className={"nav-btn" + (page === "deals" ? " nav-on" : "")} onClick={() => setPage(page === "deals" ? "none" : "deals")}>
            Deals{dealsCount > 0 ? ` · ${dealsCount}` : ""}
          </button>
          <button className={"nav-btn" + (page === "market" ? " nav-on" : "")} onClick={() => setPage(page === "market" ? "none" : "market")}>
            Marketplace
          </button>
          <button className={"nav-btn" + (page === "economy" ? " nav-on" : "")} onClick={() => setPage(page === "economy" ? "none" : "economy")}>
            Economy
          </button>
          <button className={"nav-btn" + (page === "leasing" ? " nav-on" : "")} onClick={() => setPage(page === "leasing" ? "none" : "leasing")}>
            Leasing
          </button>
          <button className={"nav-btn" + (page === "books" ? " nav-on" : "")} onClick={() => setPage(page === "books" ? "none" : "books")}>
            Books
          </button>
          <span className="topbar-sep" />
          <button
            className={"lens-btn" + (lens === "land" ? " lens-on" : "")}
            onClick={() => setLens(lens === "land" ? "none" : "land")}
            title="Land value lens — shade every lot by current land $/sf"
          >
            ◧ Land
          </button>
          <button
            className={"lens-btn" + (lens === "demand" ? " lens-on lens-on-teal" : "")}
            onClick={() => setLens(lens === "demand" ? "none" : "demand")}
            title="Demand lens — transit + employment gravity, the why behind the rents"
          >
            ◨ Demand
          </button>
          <button className="advance-btn" onClick={advance} disabled={!!game.gameOver} title="One month (Space)">
            Advance ▸
          </button>
          <button className="advance-btn advance-fast" onClick={advanceYear} disabled={!!game.gameOver} title="A year, stopping if something needs you (Y)">
            Yr ▸▸
          </button>
          <button className="advance-btn advance-fast" onClick={advanceUntil} disabled={!!game.gameOver} title="Skip to the next thing that needs a decision, up to 3 years (N)">
            ⏭
          </button>
        </div>
      )}

      <div className="topbar-right">
        {/* SAVES, WHERE SOMEBODY CAN FIND THEM. The whole save/load panel was
            built and then rendered only at the bottom of the Books page, under
            the ledger — which is the same as not having one. It is a top-level
            control now, because loading a game is not an accounting task. */}
        <button
          className={"lens-btn" + (page === "saves" ? " lens-on" : "")}
          title="Save this run under a name, or load one back"
          onClick={() => setPage(page === "saves" ? "none" : "saves")}
        >
          ⛁ Saves
        </button>
        {/* No window.confirm here. Browsers that suppress dialogs (an iframe,
            or "prevent this page from creating dialogs" ticked once) make
            confirm() return false silently and forever — the button reads as
            dead. A two-click arm-then-fire needs nothing from the browser. */}
        <button
          className={"lens-btn" + (armNewRun ? " lens-on" : "")}
          title="Start over: fresh city, no holdings, $6M cash"
          onClick={() => {
            if (!armNewRun) { setArmNewRun(true); setTimeout(() => setArmNewRun(false), 4000); return; }
            setArmNewRun(false);
            useStore.getState().newRun();
          }}
        >
          {armNewRun ? "Erase this game?" : "↺ New run"}
        </button>
        <span className={"stat mono " + (fps >= 55 ? "fps-good" : fps >= 30 ? "fps-ok" : "fps-bad")}>
          {fps} fps
        </span>
      </div>
    </div>
  );
}

// `drop` ranks a readout's expendability when the bar runs out of width: 3
// goes first, then 2, and anything unranked never goes. Every one of these
// numbers is also on a page — Books, the Economy — so losing one costs a
// glance, not information. The controls are not rankable: they stay.
function Stat({ label, value, bad, wide, title, drop }: { label: string; value: string; bad?: boolean; wide?: boolean; title?: string; drop?: 2 | 3 }) {
  return (
    <div className={"tstat" + (wide ? " tstat-wide" : "") + (drop ? ` tstat-d${drop}` : "")} title={title}>
      <span className="tstat-label">{label}</span>
      {value && <span className={"tstat-value mono" + (bad ? " neg" : "")}>{value}</span>}
    </div>
  );
}
