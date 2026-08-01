import { useStore, derivedNetWorth, derivedQuarterCF } from "@/state/store";
import { monthLabel, CAMPAIGN_MONTHS } from "@/engine/types";
import { usd, pct } from "./format";

export default function TopBar() {
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

  return (
    <div className="topbar">
      <div className="brand">
        <span className="brand-name">Broadway &amp; Wall</span>
        <span className="brand-sub">
          {manifest?.city ?? (manifest?.district === "MN" ? "Manhattan" : "Lower Manhattan · CD 1")}
        </span>
        {manifest?.source === "synthetic" && (
          <span className="badge badge-warn" title="Generated stand-in data — run `pnpm pipeline` on an open network to fetch real PLUTO data.">
            SYNTHETIC DEV DATA
          </span>
        )}
      </div>

      {game && (
        <div className="topbar-game">
          <Stat label={monthLabel(game.month)} value={`Yr ${Math.floor(game.month / 12) + 1}/${CAMPAIGN_MONTHS / 12}`} wide />
          <Stat label="Cash" value={usd(game.cash)} bad={game.cash < 0} />
          <Stat label="Net worth" value={usd(nw)} />
          <Stat label="CF / mo" value={usd(cf)} bad={cf < 0} />
          <Stat label="Index" value={pct(game.econ.indexRate)} />
          <Stat label="Market" value={game.econ.phase} />
          <Stat
            label="City built"
            value={game.totalLots
              ? Math.round((100 * (game.builtAtStart + Object.keys(game.built).length)) / game.totalLots) + "%"
              : "—"}
          />
          <span className="topbar-sep" />
          <button className={"nav-btn" + (page === "portfolio" ? " nav-on" : "")} onClick={() => setPage(page === "portfolio" ? "none" : "portfolio")}>
            Portfolio
          </button>
          <button className={"nav-btn" + (page === "deals" ? " nav-on" : "")} onClick={() => setPage(page === "deals" ? "none" : "deals")}>
            Deals{dealsCount > 0 ? ` · ${dealsCount}` : ""}
          </button>
          <button className={"nav-btn" + (page === "market" ? " nav-on" : "")} onClick={() => setPage(page === "market" ? "none" : "market")}>
            Market
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
        <button
          className="lens-btn"
          title="Start over: fresh city, no holdings, $6M cash"
          onClick={() => { if (window.confirm("Start a new run? Your current game will be erased.")) useStore.getState().newRun(); }}
        >
          ↺ New run
        </button>
        <span className={"stat mono " + (fps >= 55 ? "fps-good" : fps >= 30 ? "fps-ok" : "fps-bad")}>
          {fps} fps
        </span>
      </div>
    </div>
  );
}

function Stat({ label, value, bad, wide }: { label: string; value: string; bad?: boolean; wide?: boolean }) {
  return (
    <div className={"tstat" + (wide ? " tstat-wide" : "")}>
      <span className="tstat-label">{label}</span>
      {value && <span className={"tstat-value mono" + (bad ? " neg" : "")}>{value}</span>}
    </div>
  );
}
