# unreal/

The Unreal Engine 5.8 side of Broadway & Wall. Plan and decisions: `../UE58_PLAN.md`.

| Path | What |
|---|---|
| `BroadwayWall/` | The game project (C++ only). Phase 1: the city as blocks, RTS camera, picking. |
| `spikes/BWSpike/` | Phase 0 spike project (C++ only): the web game in a browser widget (A), the sidecar client (B). |
| `sim-server/` | The engine as a Node WebSocket sidecar (spike B; kept as a headless harness). |
| `tools/mcp.mjs` | Minimal client for the editor's MCP server (`UE_MCP_URL`, default `:8000/mcp`). |
| `tools/mcp-proof.mjs` | Spawn, move, screenshot an actor through MCP. |
| `tools/spikeA-driver.js` | Drives the web game inside the widget: new game, a year, save, load. |
| `tools/serve.mjs` | Serves the playable over http (saves need a real origin). |
| `tools/export-city.mjs` | Writes a city for Unreal (`BroadwayWall/Data/city-<seed>-<size>.json`, not committed). |
| `tools/ue.ps1` | Launches the editor with the D: cache settings. |
| `shots/` | Screenshots. Full-size PNGs stay local; phase summaries are committed. |

## Running the city (Phase 1)

```bash
node unreal/tools/export-city.mjs --size metro          # -> BroadwayWall/Data/city-1-metro.json
D:/UE_5.8/Engine/Build/BatchFiles/Build.bat BroadwayWallEditor Win64 Development -Project=$PWD/unreal/BroadwayWall/BroadwayWall.uproject -WaitMutex
D:/UE_5.8/Engine/Binaries/Win64/UnrealEditor.exe $PWD/unreal/BroadwayWall/BroadwayWall.uproject -game -windowed -ResX=1600 -ResY=900
# add -Shots=$PWD/unreal/shots/phase1 to fly the fixed cameras, save PNGs and quit
```

Live economy (Phase 2), from the sidecar harness:

```bash
node unreal/sim-server/server.mjs 8792 &
D:/UE_5.8/Engine/Binaries/Win64/UnrealEditor.exe $PWD/unreal/BroadwayWall/BroadwayWall.uproject -game -windowed -Sim=ws://127.0.0.1:8792 -Years=20 -Shots=$PWD/unreal/shots/phase2
```

## Re-running Phase 0

All from the repo root. UE is not registered with Windows, so everything goes by path.

```bash
corepack pnpm install && corepack pnpm engine          # engine bundle for the sidecar
D:/UE_5.8/Engine/Build/BatchFiles/Build.bat BWSpikeEditor Win64 Development -Project=$PWD/unreal/spikes/BWSpike/BWSpike.uproject -WaitMutex
```

Spike A (two launches; the second loads the first one's save):

```bash
node unreal/tools/serve.mjs broadway-and-wall/playable 8765 &
UE=D:/UE_5.8/Engine/Binaries/Win64/UnrealEditor.exe; P=$PWD/unreal/spikes/BWSpike/BWSpike.uproject
MAP="/Engine/Maps/Templates/Template_Default?game=/Script/BWSpike.BWSpikeGameMode"
"$UE" "$P" "$MAP" -game -windowed -ResX=1600 -ResY=900 -SpikeA=http://127.0.0.1:8765/ -SpikeAScript=$PWD/unreal/tools/spikeA-driver.js -ShotDir=$PWD/unreal/shots/phase0
"$UE" "$P" "$MAP" -game -windowed -ResX=1600 -ResY=900 -SpikeA=http://127.0.0.1:8765/ -SpikeAScript=$PWD/unreal/tools/spikeA-driver.js -ShotDir=$PWD/unreal/shots/phase0
# metro timing: -SpikeA="http://127.0.0.1:8765/?size=metro"
```

Spike B:

```bash
node unreal/sim-server/server.mjs 8790 &
"$UE" "$P" "$MAP" -game -windowed -SpikeB=ws://127.0.0.1:8790 -SpikeBSize=metro -ShotDir=$PWD/unreal/shots/phase0
```

Results land in the log (`LogBWSpike`) and `shots/phase0/spike-log.txt`.

Gotchas: UBT refuses to build while any editor on this engine has Live Coding
running; a separate project can pass `-NoHotReloadFromIDE`. Two CEF hosts can
run at once (each gets its own cache folder).
