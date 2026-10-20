# Assets the game uses from City Sample

City Sample content is **never committed** (UE58_PLAN.md §2). The game project
copies exactly the assets it uses, at the same `/Game/...` paths, from a local
City Sample (`D:\Projects\CitySample`, converted to UE 5.8). To rebuild on another
machine with City Sample installed:

```bash
# 1. survey a kit (pieces, bounds, full dependency closure) and dump Epic's grammar for it
UnrealEditor-Cmd.exe <CitySample>.uproject -run=pythonscript -script="unreal/tools/kit-survey.py CHF unreal/kits/kit-CHF.json" -unattended -nullrhi
UnrealEditor-Cmd.exe <CitySample>.uproject -run=pythonscript -script="unreal/tools/grammar-dump.py CHF unreal/kits/grammar-CHF" -unattended -nullrhi
# 2. copy the closure into the game, and build the table the facade builder reads
node unreal/tools/migrate-kit.mjs CHF
node unreal/tools/kit-table.mjs CHF
```

The surveys (`unreal/kits/kit-*.json`) and grammar dumps are committed, so on a
machine with City Sample only step 2 is needed.

| Kit | City Sample folder | Used for | Closure |
|---|---|---|---|
| CHF | `/Game/Building/CH/F` | retail, pre-war office/housing (brick, granite) | 691 assets, 1.8 GB |
| CHH | `/Game/Building/CH/H` | older commercial, industrial (brown granite) | 704 assets |
| NYH | `/Game/Building/NY/H` | pre-war apartments (red brick, limestone) | 518 assets |
| SFC | `/Game/Building/SF/C` | modern office (glass, brushed panel) | 317 assets |
| SFE | `/Game/Building/SF/E` | office/retail (granite, glass) | 455 assets |

Not used yet: SFD (its grammar points at the experimental CitySamplePCG plugin's
own mesh copies, `/CitySamplePCG/Meshes/...`, not `/Game`).

Project settings the kits need (in `BroadwayWall/Config/DefaultEngine.ini`):
DX12 with SM6 shaders, Substrate, virtual textures, no static lighting.

## NVIDIA DLSS (not committed: 1.7 GB of binaries)

The game uses NVIDIA's official DLSS 4.5 plugin for UE 5.8 (v8.9.0, NGX
310.9.16), from https://developer.nvidia.com/rtx/dlss ("Download UE 5.8 DLSS
Plugin"; no sign-in needed as of 2026-10-20). From the zip, copy
`Plugins/DLSS` and `Plugins/StreamlineNGXCommon` (DLSS depends on it) into
`unreal/BroadwayWall/Plugins/`. Super Resolution only: Frame Generation needs an
RTX 40-series. Without the plugin the game still runs and upscales with TSR.
The Graphics setting picks DLAA (high), DLSS Quality (medium) or Performance (low);
`-NoDLSS` turns it off.
