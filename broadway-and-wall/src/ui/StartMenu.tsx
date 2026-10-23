import { useEffect, useState } from "react";
import { useStore } from "@/state/store";
import { monthLabel } from "@/engine/types";
import { cityList, cityName, sizeList, developmentList } from "@/citygen/index.mjs";
import { BUILD_STAMP } from "@/buildStamp";
import { usd } from "./format";
import { loadRuns } from "./RunRecords";
import { ordinal } from "@/engine/standing";
import GameSetup from "./GameSetup";

/**
 * THE START SCREEN (revamped 2026-10-22, owner: "the home screen could use a
 * revamp like the rest of the UI"). Three things, in the order a returning
 * player wants them: Continue, New game, and the saves. The record of past
 * runs sits under the saves. A first-time player has nothing to continue and
 * nothing saved, and is taken straight to the setup, whose defaults are the
 * standard game on the region.
 *
 * Nothing is generated until Break ground is pressed on the setup page.
 */
export default function StartMenu() {
  const phase = useStore((s) => s.phase);
  const resume = useStore((s) => s.resume);
  const building = useStore((s) => s.building);
  const loadError = useStore((s) => s.loadError);
  const continueRun = useStore((s) => s.continueRun);
  const slots = useStore((s) => s.slots);
  const [setup, setSetup] = useState(false);
  useEffect(() => { if (phase === "menu") void useStore.getState().refreshSlots().catch(() => {}); }, [phase]);

  const sizes = sizeList();
  const devs = developmentList();
  const islandName = (id: string) => cityList().find((c) => c.id === id)?.name ?? id;
  // A SAVED TOWN IS NAMED, even the generated one — the save carries its seed.
  const townName = (id: string, seed: number) => cityName(id, seed) || islandName(id);

  if (phase === "generating") {
    return (
      <div className="start" aria-busy="true">
        <div className="start-wait">
          <div className="start-title">{building ?? "The city"}</div>
          <div className="start-wait-line">Cutting the blocks, drawing the lot lines.</div>
          <div className="start-bar"><span /></div>
        </div>
      </div>
    );
  }

  const runs = loadRuns();
  const firstTime = phase === "menu" && !resume && runs.length === 0 && slots.length === 0;
  if (phase === "menu" && (setup || firstTime)) {
    return <GameSetup onBack={firstTime ? undefined : () => setSetup(false)} />;
  }

  return (
    <div className="start hm">
      <div className="hm-wrap">
        <header className="hm-brand">
          <div className="start-title">Broadway &amp; Wall</div>
          <div className="hm-tag">Build a real estate firm. A hundred years to do it.</div>
        </header>

        {phase === "boot" ? (
          <div className="hm-boot">Looking for a game&hellip;</div>
        ) : (
          <div className="hm-grid">
            <section className="hm-play">
              {resume && (
                <button type="button" className="hm-continue" onClick={() => void continueRun()}>
                  <span className="hm-k">Continue</span>
                  <span className="hm-town">{townName(resume.island, resume.seed)}</span>
                  <span className="hm-meta mono">
                    {sizes.find((s) => s.id === resume.size)?.name ?? (resume.island === resume.size ? "6 km region" : resume.size)}
                    {" · "}{devs.find((x) => x.id === resume.dev)?.name ?? resume.dev}
                  </span>
                  <span className="hm-stats">
                    <span><b className="mono">{monthLabel(resume.month)}</b><i>date</i></span>
                    <span><b className="mono">{Math.floor(resume.month / 12) + 1}</b><i>year</i></span>
                    <span><b className="mono">{usd(resume.cash)}</b><i>cash</i></span>
                  </span>
                  <span className="hm-go">Resume ▸</span>
                </button>
              )}
              <button type="button" className={"hm-new" + (resume ? "" : " hm-new-primary")} disabled={phase !== "menu"} onClick={() => setSetup(true)}>
                <span className="hm-k">New game</span>
                <span className="hm-new-line">Region, island or Manhattan · your firm · your seed</span>
                <span className="hm-go">Set up ▸</span>
              </button>
              {loadError && <div className="start-err">{loadError}</div>}
            </section>

            <section className="hm-side">
              <div className="hm-box">
                <div className="hm-box-head">Saves<span className="hm-count mono">{slots.length}</span></div>
                {slots.length === 0 ? <div className="hm-none">No named saves</div> : (
                  <table className="hm-table">
                    <thead><tr><th>Name</th><th className="num">Date</th><th className="num">Cash</th><th /></tr></thead>
                    <tbody>
                      {slots.slice(0, 8).map((m) => (
                        <tr key={m.slot} title={m.setup}>
                          <td className="hm-slot">{m.slot}{m.sandbox && <span className="hm-chip">sandbox</span>}</td>
                          <td className="num mono">{monthLabel(m.month)}</td>
                          <td className="num mono">{usd(m.cash)}</td>
                          <td className="num"><button type="button" className="hm-load" disabled={phase !== "menu"} onClick={() => void useStore.getState().openSlot(m.slot)}>Load</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              {runs.length > 0 && (
                <div className="hm-box">
                  <div className="hm-box-head">Best runs</div>
                  <table className="hm-table">
                    <thead><tr><th>Town</th><th className="num">Years</th><th className="num">Peak NW</th><th className="num">Best rank</th><th className="num">Goal</th></tr></thead>
                    <tbody>
                      {runs.slice(0, 5).map((r) => (
                        <tr key={r.seed} title={r.setup ?? undefined}>
                          <td className="hm-slot">{r.town}{!r.over && <span className="hm-chip">live</span>}</td>
                          <td className="num mono">{r.years}</td>
                          <td className="num mono">{usd(r.peakNw)}</td>
                          <td className="num mono">{r.bestRank !== null ? `${ordinal(r.bestRank)} / ${r.of}` : "—"}</td>
                          <td className="num mono">{r.goal ? (r.goalResult === "met" ? "✓" : r.goalResult === "missed" ? "✗" : "…") : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
        <footer className="hm-foot mono">build {BUILD_STAMP.commit} · the economy is drawn fresh every game</footer>
      </div>
    </div>
  );
}
