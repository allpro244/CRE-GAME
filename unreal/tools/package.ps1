# Phase 6: a Windows build of Broadway & Wall.
#   powershell -File unreal/tools/package.ps1 [-Out D:\Builds\BroadwayWall] [-Config Development|Shipping]
# Copies the web game into Data/web (the packaged build serves it from there),
# then builds, cooks (all migrated City Sample content: it is loaded by path),
# stages, paks and archives. The first cook compiles every SM6 shader the kits
# use and takes hours; later ones reuse the DDC.
param([string] $Out = 'D:\Builds\BroadwayWall', [string] $Config = 'Development')
$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$Project = Join-Path $Root 'unreal\BroadwayWall\BroadwayWall.uproject'
$Web = Join-Path $Root 'unreal\BroadwayWall\Data\web'
New-Item -ItemType Directory -Force $Web | Out-Null
Copy-Item (Join-Path $Root 'broadway-and-wall\playable\broadway-and-wall.html') $Web -Force
# No DDC override here: a Zen server already running on another data path
# (started by an editor launched without it) makes the cook's oplog 404.
# Build the game target first: UBT run directly accepts -NoHotReloadFromIDE,
# which it needs while any editor on this engine has Live Coding open;
# BuildCookRun's own build step does not pass it through.
& 'D:\UE_5.8\Engine\Build\BatchFiles\Build.bat' BroadwayWall Win64 $Config "-Project=$Project" -WaitMutex -NoHotReloadFromIDE
if ($LASTEXITCODE) { exit $LASTEXITCODE }
& 'D:\UE_5.8\Engine\Build\BatchFiles\RunUAT.bat' BuildCookRun "-project=$Project" -noP4 -platform=Win64 "-clientconfig=$Config" `
  -skipbuild -nocompileeditor -cook -stage -pak -archive "-archivedirectory=$Out" -unattended -utf8output
exit $LASTEXITCODE
