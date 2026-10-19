# Broadway & Wall on Unreal Engine 5.8 — the plan

> **Status (2026-10-19, owner's decision):** the game moves to Unreal Engine 5.8.
> The web build (`broadway-and-wall/`, React + MapLibre + Three.js) is
> **frozen**: no new features, no new economy rounds, no new UI. It stays in
> the repo as the reference implementation and as the source of the economy
> engine, which the Unreal game reuses as-is. The goal of the move is
> photoreal graphics, Matrix Awakens / City Sample quality.

Read this file first in any session that works on the Unreal game. Read
`broadway-and-wall/CLAUDE.md` and `broadway-and-wall/HANDOFF.md` before
touching the economy engine.

---

## 1 · What we are moving, measured

| Part | Where | Size | Fate |
|---|---|---|---|
| Economy engine | `broadway-and-wall/src/engine/` | ~73k lines TS | **Keep, unchanged.** Runs beside Unreal. |
| City generator | `broadway-and-wall/src/citygen/` | ~11k lines JS | **Keep.** Makes the parcel table; Unreal draws it. |
| Tests + baseline | `broadway-and-wall/test/`, `BASELINE.json` | 223 files | **Keep.** Still the guard on the economy. |
| Desk UI (panels, docket, charts) | `broadway-and-wall/src/ui/` | ~30k lines React | **Keep at first** (shown inside Unreal), port piece by piece later. |
| 3D map | `broadway-and-wall/src/map/` | ~21k lines Three.js/MapLibre | **Replace** with Unreal. |
| State / workers / saves | `broadway-and-wall/src/state/` | ~3k lines | Adapt: the store talks to Unreal instead of MapLibre. |

The engine is pure functions over a `GameState` (it already runs in a Web
Worker: `src/state/simWorker.ts` takes `town`, `month` and `span` messages).
That is the seam: whatever hosts the engine, Unreal only needs the state.

**The one rule that makes this tractable: do not rewrite the economy in C++.**
Seventy-three thousand lines of tuned, tested simulation would take longer to
port and re-verify than everything else in this plan together, and every
behaviour we measured would be at risk. Unreal is the renderer and the shell;
the TypeScript engine stays the brain.

---

## 2 · Architecture

```
┌──────────────────────────── Unreal Engine 5.8 (C++) ─────────────────────────┐
│  World: City Sample kit + PCG  ←  CityBuilder (C++)  ←  CityState (C++)      │
│  Camera, picking, construction FX, day/night, traffic, crowds               │
│                                                    ▲                        │
│  UI layer: WebBrowser widget (Chromium) running the existing React desks    │
│            ── JS ↔ C++ bridge (BindUObject) ──────────┘                      │
└──────────────────────────────────────────────────────────────────────────────┘
                 ▲ state snapshots / diffs (JSON)   │ player actions
                 │                                  ▼
        Economy engine (TypeScript, unchanged) + city generator
```

Two ways to host the engine. **Phase 0 decides which by experiment**, not by
argument:

- **A. Engine inside the browser widget.** The web app's code, minus the map,
  runs in Unreal's built-in Chromium exactly as it runs today (worker and
  all). It pushes the render state to C++ through the JS bridge. No extra
  process, saves keep working, the desks work on day one. Risk: the Chromium
  version shipped with the UE WebBrowser plugin may lack something the app
  uses (module workers, a JS feature), or be slow on a large city.
- **B. Engine as a Node sidecar.** A small Node process
  (`unreal/sim-server/`) loads the same engine bundle (`test/.engine.mjs` is
  already a self-contained build of it), holds the authoritative `GameState`,
  and talks to Unreal over a local WebSocket: `town`, `month`, `span`, and one
  `action` message that calls any exported engine action (`buyListing`,
  `startDevelopment`, ...) by name. Packaged with Node's single-executable
  build so players need nothing installed. The desks still run in the browser
  widget, as a client of the sidecar.

Default expectation: **A**, falling back to **B** if the spike shows a blocker.
Either way the C++ side is identical: it receives a city and a stream of state.

### The render contract (what Unreal needs from the engine)

Not the whole `GameState` (megabytes, mostly ledgers). A **map view** built in
TypeScript and sent on load and after each month, as a diff where possible:

- **Per parcel** (static, on load): id (BBL), footprint polygon in metres,
  block, district, lot area, zoning envelope.
- **Per parcel** (dynamic): use class, floors, gross sf, year built, condition
  grade, owner (player / which rival / street), vacancy share, under
  construction (start month, delivery month, progress, target floors and
  use), demolished, landmark, listed for sale, distress.
- **City**: month/date, season, the economic phase, demand pockets.
- **Events** for set-pieces: groundbreak, topping out, delivery, demolition,
  foreclosure, black swan.

This contract is written down as a TypeScript type (`unreal/contract.ts`) and a
matching C++ struct, and checked by a test, so the two sides cannot drift.

### Repository layout

```
unreal/
  BroadwayWall/                 the UE 5.8 project: Source/ (C++), Config/, Plugins/
                                — text only in git; Content/ binaries via Git LFS, kept small
  sim-server/                   (only if option B) the Node sidecar
  contract.ts                   the render contract
  tools/                        export, screenshot and check scripts
UE58_PLAN.md                    this file
broadway-and-wall/              frozen web build + the engine and generator we reuse
```

**City Sample is never committed.** It is ~100 GB of Epic content that lives
in `D:\Projects\CitySample` on the build PC. The game project references or
migrates only the assets it uses. A list of which ones goes in
`unreal/ASSETS.md` so the project can be rebuilt on another machine.

---

## 3 · How an AI agent works on this with the owner hands-off

The owner's machine: i9-9900K, 32 GB RAM, RTX 2080 8 GB, Windows. UE 5.8 at
`D:\UE_5.8`, Visual Studio 2026 Community (C++ game, desktop C++, .NET
workloads), Node 24 LTS, Git, Claude Desktop. Projects in `D:\Projects`.

- **Write C++ and Python, never Blueprints.** Blueprints are binary `.uasset`
  files an agent cannot read, diff or review. Gameplay and tools live in
  `Source/` (C++) and editor Python scripts. Blueprints only as thin data
  shells if unavoidable.
- **Drive the editor through the Unreal MCP server** that ships with 5.8 (City
  Sample 5.8 is described as built for "LLMs to build cities using the Unreal
  MCP server"). Fall back to editor Python (`unreal` module) and commandlets.
- **Build headless:** `RunUAT.bat BuildCookRun` / `UnrealBuildTool` from the
  command line; no clicking in Visual Studio.
- **Check its own work:** an automation test or editor script that loads the
  city, flies a fixed set of cameras and saves high-resolution screenshots to
  `unreal/shots/`, so every change can be looked at, and compared with the
  last one. The owner looks at screenshots on the phone, not at the editor.
- **Keep the economy tests green.** Any engine change still goes through
  `pnpm check` in `broadway-and-wall/`.
- **Disk:** keep `C:` free. Set `UE-LocalDataCachePath=D:\UnrealDDC` and the
  Epic launcher's vault cache on `D:`.
- **Session from the phone:** `claude remote-control` (or the Desktop app's
  Code session) in `D:\Projects`; the PC stays awake.

---

## 4 · Phases

Each phase ends in something the owner can see: a screenshot set or a build.

### Phase 0 — Toolchain and spikes
1. Confirm the toolchain builds a blank C++ UE 5.8 project from the command
   line, and that the City Sample opens and compiles shaders.
2. Connect the Unreal MCP server; prove an agent can spawn, move and screenshot
   actors without a human.
3. **Spike A:** load `broadway-and-wall/playable/broadway-and-wall.html` in a
   WebBrowser widget inside UE. Does it start, run a year, save and load? Time
   a month on the metro city.
4. **Spike B:** run `test/.engine.mjs` in Node behind a WebSocket; Unreal
   advances a month and reads the state back.
5. Pick A or B and write the decision here.

**Done when:** a screenshot of the web game running inside an Unreal window,
and a note of which host was chosen and why.

### Phase 1 — The city as blocks
- Export the parcel table and footprints from `makeCity` (`unreal/tools/`).
  The generator's units go to centimetres (UE world units), north up, the
  origin at the city centre.
- C++ `CityBuilder` extrudes each parcel to its floors × storey height as plain
  boxes, colours them by use, and lays out streets from the block geometry.
- RTS-style camera (pan, zoom, orbit), plus parcel picking (click → BBL).

**Done when:** the metro city stands in Unreal at the right size, every
building the right height, and clicking one names its address.

### Phase 2 — Live economy
- Wire the engine host to `CityState`: start a game, advance months, and the
  blocks change as the economy builds, demolishes and repurposes.
- Construction is visible: hoarding, a rising frame, a crane, opening day.
- The React desks show in an overlay, and selecting a parcel in either place
  selects it in both.

**Done when:** a 20-year autoplay in Unreal shows the skyline growing, and the
game is playable end to end with the existing desks.

### Phase 3 — Photoreal
- Replace blocks with City Sample buildings: a kit-of-parts chooser by use,
  height, footprint, era (year built), quality tier and condition. Use the
  5.8 building primitives and PCG so a building of any footprint and floor
  count can be made, not only the sample's prebuilt ones.
- Streets, sidewalks, street furniture, traffic and crowds from City Sample's
  systems (Mass), scaled to the city's density.
- Lumen lighting, a sky and weather tied to the game calendar (season, time
  of day), lights in occupied floors and dark windows in vacant ones.
- Water, piers and parks from the generator's layers.

**Done when:** a screenshot set the owner would call "blows your socks off",
running at 1440p with DLSS at a playable frame rate on the RTX 2080.

### Phase 4 — Game feel
- Set-pieces for the moments that matter: groundbreak, topping out, the
  delivery ceremony, demolition, a foreclosure sign, a black swan's effect on
  the street.
- Camera modes: a strategy view, a drone flyover, and a street-level walk.
- The player's own buildings: the `BuildingDesign` choices (facade family,
  crown, materials) mapped to real kit choices.
- Sound: street, construction, weather.

### Phase 5 — The UI, native
- Port the most-used surfaces to UMG (C++-driven): top bar, docket, the
  property card, the map HUD. The deep desks can stay in the browser layer
  as long as they work well; port them only where it helps.

### Phase 6 — Ship
- Windows packaged build, an installer, saves in the user's folder, graphics
  settings (DLSS, Lumen quality, crowd density), performance pass, a crash
  reporter.

---

## 5 · Risks and how we handle them

| Risk | Handling |
|---|---|
| 8 GB of VRAM is tight for City Sample | Nanite + virtual textures, cut texture pool, DLSS; city size settings; Phase 3 has a frame-rate budget. |
| 32 GB RAM is tight for City Sample in the editor | Work in a smaller sub-level; a 64 GB upgrade is the cheapest fix if it bites. |
| The browser widget's Chromium can't run the app | Option B (Node sidecar) is designed in from Phase 0. |
| The UE project is mostly binary and agents can't read it | C++/Python only; Content kept small; MCP + screenshots for verification. |
| City Sample's buildings are prebuilt, ours vary | 5.8 building primitives + PCG kit-of-parts; a block-level fallback. |
| Economy drift while the shell changes | Engine untouched; `pnpm check` and `BASELINE.json` stay the gate. |
| Repo size | City Sample never committed; Git LFS for our own few assets. |
| Licensing | City Sample content is licensed for use in Unreal Engine projects (Epic's content license and the UE EULA, including its royalty terms if the game is ever sold). Re-check before release. |

---

## 6 · Decisions the owner makes

1. **Which city first:** the generated metro island (default, ~3,000 parcels)
   or Manhattan. Recommendation: the metro island first, Manhattan once the
   pipeline works.
2. **Art direction:** City Sample's contemporary American downtown as-is, or
   an era look (the game starts in the past). Recommendation: as-is first.
3. **Keep the web build playable during the move?** Recommendation: yes,
   frozen, as the reference until the Unreal game reaches Phase 2.

---

## 7 · First message for the session on the PC

> Clone https://github.com/allpro244/CRE-GAME into D:\Projects\CRE-GAME. Read
> UE58_PLAN.md, AGENTS.md, broadway-and-wall/CLAUDE.md. Then start Phase 0:
> check the toolchain (UE 5.8 at D:\UE_5.8, Visual Studio, Node, Git), set
> UE-LocalDataCachePath to D:\UnrealDDC, connect the Unreal MCP server, and
> run spikes A and B. Read §8 (handoff) first. Report back with screenshots
> and a recommendation before building anything else.

---

## 8 · Handoff from the cloud session (2026-10-19)

Everything a new session needs that is not in the code. Read it once.

### The owner's standing rules (apply to all work, web or Unreal)

- **Realism over everything.** The economy decides outcomes; do not tune
  results by hand. When a number looks wrong, find the mechanism.
- **Merge to main when a piece of work is done**, and send the latest playable
  (`broadway-and-wall/playable/broadway-and-wall.html`) to the owner. For the
  Unreal game, the equivalent is screenshots or a packaged build.
- **At most 4 concurrent heavy processes** on a machine (tests, sims, builds).
- **Economy changes regenerate `broadway-and-wall/BASELINE.json`** and run the
  full suite (`pnpm check` plus the long tests) before merging. Never edit
  `src/` in a worktree while its suite is running: the tests assert a fresh
  engine bundle and every later test fails as "STALE".
- **Commit trailers** end with `Co-Authored-By:` and `Claude-Session:` lines;
  PR bodies end with the "Generated with Claude Code" line. No model names in
  commits or PRs.
- **Off the table unless the owner raises it:** zoning/entitlements work, a
  telework era, removing the 0.05% loan-rate floor, a "today's dollars"
  display. **On hold:** the Pruitt fix, swans, spreading big-firm seizures over
  years.
- **UI:** the owner finds the current UI cluttered with explanatory prose ("AI
  slop"). Numbers and short labels first; explanations only on hover; at most
  one hint per screen, and only when something blocks the player. Build the
  Unreal UI to this from the start; a full revamp is planned.
- The owner works from a phone a lot: keep messages short, lead with what they
  need to do or decide.

### State of the web build (frozen, but these are open)

- **Last merges:** #396 rival lot assembly, #397 this plan, #398 free
  listings + deferred leasing commissions + flipped demand map +
  `rivalDealTerms` on by default, #399 Fed alerts only for a new chair or a
  massive move + property card shows sf let.
- **Not yet verified on main:** the full suite and a `BASELINE.json`
  regeneration were skipped on #398 and #399 at the owner's request. Run them.
- **`test/buybox.mjs` fails since #398.** Cause found: with `rivalDealTerms`
  on by default, seed 31337 sees no broker first look in 240 months (month 114
  with it off). Fix the test by pinning `{ rivalDealTerms: false }` in its
  `newGame` setup, and separately check across seeds whether first looks have
  become too rare under the new default — that would be a gameplay problem.
- **`test/deed-goes.mjs` fails on main** ("Calloway & Reed now owns the
  deed — no rival owner"); it predates all of the above.
- **Development raise rework — proposed, waiting on the owner.** Playtest
  (30 seeds, $1M start): 0 of 19 raises filled, 9 closed small at exactly 3
  months, 10 failed and lost their counsel. Proposal: "Commit to build" starts
  pre-development (design/permits, like the rivals' `PLAN_LEAD_M`) and the
  raise together, ground breaks when both are done; the player can close with
  what is circled and cover the rest, top up, extend once or pull; investor
  pace shown up front from reputation, the deal's return and the pool, not a
  monthly dice roll; optionally LP capital calls during construction. Do not
  build it until the owner says so.

### The owner's PC, as set up today

- Windows 10, i9-9900K, 32 GB RAM, RTX 2080 8 GB. `C:` is nearly full — keep
  everything on `D:`.
- Unreal Engine 5.8 at `D:\UE_5.8`. The engine is **not registered with
  Windows**: double-clicking a `.uproject` said "No Unreal Engine installations
  found". Open projects with
  `"D:\UE_5.8\Engine\Binaries\Win64\UnrealEditor.exe" "<project>.uproject"`
  or register it with `UnrealVersionSelector.exe` in the same folder.
- City Sample at `D:\Projects\CitySample`, converted in place to 5.8. Project
  files were generated by hand with
  `D:\UE_5.8\Engine\Build\BatchFiles\Build.bat -projectfiles -project=... -game -rocket -progress`
  after the editor's own attempt failed. First open was compiling shaders at
  handoff.
- Visual Studio Community 2026 at `D:\Program Files` (C++ game, desktop C++,
  .NET workloads). MSVC 14.51.36260 is the only toolchain; UE 5.8 warns it is
  newer than its preferred 14.50.35717. If C++ builds misbehave, install the
  14.50 toolset from the VS Installer's Individual components.
- Epic launcher's Fab cache: `D:\EpicVaultCache\VaultCache` (holds a second
  ~96 GB copy of City Sample; safe to clear if space is needed).
- `UE-LocalDataCachePath` should be `D:\UnrealDDC` — confirm it is set.
- Node 24 LTS, Git, Claude Desktop installed. The owner controls sessions
  from the phone via `claude remote-control`.
