#!/usr/bin/env bash
# Frame-time matrix on one city: each line runs the drone flight for N seconds
# with one change and prints the PERF line, so the costly feature is obvious.
#   bash unreal/tools/perf-matrix.sh [city.json] [seconds] [WxH]
set -u
CITY=${1:-D:/Projects/CRE-GAME/unreal/BroadwayWall/Data/city-1-metro.json}
SECS=${2:-30}
RES=${3:-2560x1440}
W=${RES%x*}; H=${RES#*x}
UE="/d/UE_5.8/Engine/Binaries/Win64/UnrealEditor.exe"
P="D:/Projects/CRE-GAME/unreal/BroadwayWall/BroadwayWall.uproject"
LOGS=/d/Projects/CRE-GAME/unreal/BroadwayWall/Saved/Logs
run() {
  local name=$1; shift
  timeout 900 "$UE" "$P" -game -windowed -ResX=$W -ResY=$H -log=PerfM-$name.log -City=$CITY -NoTraffic -Perf=$SECS "$@" >/dev/null 2>&1
  local line; line=$(grep -oE "PERF .*" $LOGS/PerfM-$name.log | head -1)
  printf '%-14s %s\n' "$name" "${line:-no result (timed out)}"
}
run base
run half-res     "-ExecCmds=r.ScreenPercentage 50"
run no-vsm       "-ExecCmds=r.Shadow.Virtual.Enable 0"
run no-lumen     "-ExecCmds=r.DynamicGlobalIlluminationMethod 0,r.ReflectionMethod 2"
run no-facades   -NoFacades
