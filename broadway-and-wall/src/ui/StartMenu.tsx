import { useState } from "react";
import { useStore } from "@/state/store";
import { monthLabel } from "@/engine/types";
import { cityList, cityName, sizeList, developmentList } from "@/citygen/index.mjs";
import { BUILD_STAMP } from "@/buildStamp";
import { usd } from "./format";
import { loadRuns } from "./RunRecords";
import { ordinal } from "@/engine/standing";
import GameSetup from "./GameSetup";

/**
 * THE START SCREEN.
 *
 * There was not one: the app generated a town on mount and the player woke up
 * in it, and the only way to ask for a different one was a dropdown hanging
 * off the top bar. With three sections in it — how big, how built up, which
 * island: fourteen options — that dropdown measured 973px tall at 1280x720,
 * putting its "Build …" confirm button 353px below the bottom of the window
 * with no way to scroll to it. A custom city was unreachable, which is to say
 * unbuildable.
 *
 * So the choice gets a room instead of a dropdown — and now a whole page: the
 * GAME SETUP (GameSetup.tsx) holds every choice a new campaign makes, from the
 * island to the era to the clock, with the confirm button in a footer OUTSIDE
 * the scroller so it cannot go off the bottom of anything.
 *
 * This screen is the lobby in front of it: Continue first, because for anyone
 * who has played before it is the only thing they came here to press; then
 * the record; then the door to a new campaign. A first-time player has none
 * of the first two and is taken straight to the setup, whose defaults are
 * the standard game.
 *
 * Nothing is generated until Break ground is pressed.
 */
export default function StartMenu() {
  const phase = useStore((s) => s.phase);
  const resume = useStore((s) => s.resume);
  const building = useStore((s) => s.building);
  const loadError = useStore((s) => s.loadError);
  const continueRun = useStore((s) => s.continueRun);
  const [setup, setSetup] = useState(false);

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
          <div className="start-wait-line">
            Cutting the blocks, drawing the lot lines, putting up what was built before you got here.
          </div>
          <div className="start-bar"><span /></div>
        </div>
      </div>
    );
  }

  const runs = loadRuns();
  const firstTime = phase === "menu" && !resume && runs.length === 0;
  if (phase === "menu" && (setup || firstTime)) {
    return <GameSetup onBack={firstTime ? undefined : () => setSetup(false)} />;
  }

  return (
    <div className="start">
      <div className="start-head">
        <div className="start-title">Broadway &amp; Wall</div>
        <div className="start-sub">A hundred years of somebody else&rsquo;s city, and whatever you can hold of it.</div>
        <div className="start-sub start-ambition">
          You open near the bottom of the street. Every firm above you started with a bankroll and a hundred years —
          climb past them, and build a book the town will remember. Your place is in the top bar, and every January the year is told back to you.
        </div>
      </div>

      <div className="start-body">
        <div className="start-inner">
          {phase === "boot" ? (
            <div className="start-boot">Looking for a game in progress&hellip;</div>
          ) : (
            <>
              {resume && (
                <button className="start-continue" onClick={() => void continueRun()}>
                  <span className="start-continue-l">
                    <span className="start-continue-head">Continue</span>
                    <span className="start-continue-town">
                      {townName(resume.island, resume.seed)}
                      <span className="start-continue-dim">
                        {" · "}{sizes.find((s) => s.id === resume.size)?.name ?? resume.size}
                        {" · "}{devs.find((d) => d.id === resume.dev)?.name ?? resume.dev}
                      </span>
                    </span>
                    <span className="start-continue-when">
                      {monthLabel(resume.month)} · Year {Math.floor(resume.month / 12) + 1} · {usd(resume.cash)} in hand
                    </span>
                  </span>
                  <span className="start-continue-go">Resume ▸</span>
                </button>
              )}

              {runs.length > 0 && (
                <div className="start-runs">
                  <div className="start-or" style={{ marginTop: 0 }}>Your best runs</div>
                  <table className="start-runs-tbl mono">
                    <tbody>
                      {runs.slice(0, 5).map((r) => (
                        <tr key={r.seed}>
                          <td className="start-runs-town">{r.town}</td>
                          <td>{r.years} yr{r.years === 1 ? "" : "s"}</td>
                          <td>peak {usd(r.peakNw)}</td>
                          <td>{r.bestRank !== null ? `best ${ordinal(r.bestRank)} of ${r.of} · ${r.bestYear}` : "—"}</td>
                          <td>{r.goal ? `${r.goal}: ${r.goalResult === "met" ? "✓ met" : r.goalResult === "missed" ? "missed" : "open"}` : ""}</td>
                          <td className="start-runs-setup">{r.setup ?? ""}</td>
                          <td className="start-runs-state">{r.over ? "ended" : "in progress"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {loadError && <div className="start-err">{loadError}</div>}
            </>
          )}
        </div>
      </div>

      <div className="start-foot">
        <div className="start-foot-sum">
          <span className="start-foot-town">{resume ? "Or cut a new town" : "Cut a town and break ground"}</span>
          <span className="start-foot-note">
            The setup page chooses the island, the firm and the clock. The economy is drawn fresh every game.
            {resume ? " Named saves stay on the Saves page." : ""}
            {" · "}build {BUILD_STAMP.commit} · office base ${BUILD_STAMP.rentBaseOffice}
          </span>
        </div>
        <button className="start-go" disabled={phase !== "menu"} onClick={() => setSetup(true)}>
          New campaign ▸
        </button>
      </div>
    </div>
  );
}

