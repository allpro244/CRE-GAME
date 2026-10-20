@echo off
rem Broadway ^& Wall in Unreal: the real game, desks over the 3D city.
rem Double-click to play. Uses the UE 5.8 install at D:\UE_5.8 (a packaged build comes in Phase 6).
set "UE=D:\UE_5.8\Engine\Binaries\Win64\UnrealEditor.exe"
set "UE-LocalDataCachePath=D:\UnrealDDC"
start "" "%UE%" "%~dp0BroadwayWall\BroadwayWall.uproject" -game -Play -windowed -ResX=1920 -ResY=1080
