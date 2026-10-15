# Saved link: "How to Build your own Game in Unity with Claude Opus 5.5 (Full Course)"

- **Source:** https://x.com/rewind02/status/2110309991919853638 (X Article by @rewind02, 2026-10-14)
- **Saved:** 2026-10-15, at the owner's request ("save this for the future")
- **Status:** reference only. This is not a plan and not a commitment. Broadway & Wall is a
  browser game, not a Unity game, so the engine steps don't apply. The working habits do.

## What it is

A step-by-step course that goes from an empty folder to a small playable Unity game
(a third-person courtyard: hack three relays while drones hunt you, then reach the exit).
It is built around two real Opus 5.5 projects:

- **The cyberpunk shooter.** Meshy made the models, Blender the city, ElevenLabs the sound,
  and Unity ran the game. The creator guided it step by step ("not one magic prompt").
  Claude wrote an autopilot that played four full runs. Those runs found a roof the player
  couldn't reach, nine places where he got stuck, and a boss that died in 11 seconds.
- **The 36-hour MMO.** Before starting, the creator spent hours on prep: one very large
  brief, hundreds of reference images, and his own methods packed in as skills. About 10
  agents ran in parallel. It used roughly 7.85B tokens (mostly cache reads, about $2,200
  at API prices) and a full weekly usage limit. The result is openly unfinished.

## Setup card (Unity)

1. Install Unity 6 through Hub. Create a project from the Universal 3D (URP) template. Commit.
2. In Claude Code, run `/plugin marketplace add Unity-Technologies/unity-agent-plugin`, then
   `/plugin install unity@unity-agent-plugin`.
3. Check `unity --version`. With the editor closed, run
   `unity pipeline install --project-path <project>`.
4. Open the editor and wait for `unity status` to report ready. Start Claude Code in the
   project folder and send a read-only prompt to confirm it can see the scene.

The two alternatives are Unity MCP in the `com.unity.ai.assistant` package and the
community "AI Game Developer" tool. The two big builds used the MCP route.

## Habits worth stealing (engine-agnostic)

- **One system per prompt**, each with a finish line, a "don't change" list, a report of
  every file touched, and **no silent workarounds**.
- **Proof, not a claim.** Before reporting success, Claude compiles, runs the game, proves
  frames are advancing (a frozen first frame looks just like a live game), captures a
  screenshot and reads the console.
- **Seeded runs.** Every run is shuffled by a seed, and any seed can be replayed exactly.
  Bug reports carry the seed, the steps, the expected result and the actual result, and
  ask for the cause before any change.
- **Autopilot playtests.** An autopilot plays the game through the real controls. Ask for
  the list of problems *before* any fixes, so a person decides what matters.
- **Two failed fixes means roll back**, then retry in a smaller piece or at higher effort.
- **Commit at every gate.** Keep `/clear` between tasks; the article says quality drops
  once the context window is about half full.
- **Parallel agents get disjoint files**, because two agents on the same scene overwrite
  each other.
- **Play the real build, not the dev environment.** Check frame rate on the hardware you
  care about.

## Relevance here

These habits line up with the MDGA instruments (`tools/mdga/`), the seeded sim probes
and the playthrough reports. The autopilot step ("list before fixes") is the closest to
what a no-playtest queue (`NO_PLAYTEST_PLAN.md`) would want.
