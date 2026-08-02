#!/usr/bin/env bash
# Build each city in turn and photograph it in the running game.
# Expects a dev server already listening (default 5188).
#   tools/shoot-cities.sh <outdir> [port]
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:?usage: shoot-cities.sh <outdir> [port]}"
PORT="${2:-5188}"
mkdir -p "$OUT"

for CITY in kestrel marrow thorne calder sable; do
  echo "=== $CITY"
  node pipeline/build-city.mjs "$CITY" | grep -E "lots on|COVERAGE"
  node pipeline/process.mjs >/dev/null
  node pipeline/tiles.mjs >/dev/null
  BBOX=$(node -e "console.log(JSON.stringify(require('./public/data/manifest.json').bbox))")
  CORE=$(node -e "console.log(JSON.stringify(require('./public/data/manifest.json').core))")

  # the whole city in frame — the shot that shows whether the fabric has holes
  node tools/shoot.mjs "http://127.0.0.1:$PORT/" "$OUT/$CITY-city.png" \
    --wait 13000 --w 1600 --h 1000 --settle 3500 \
    --eval "(()=>{const b=$BBOX;__map.fitBounds([[b[0],b[1]],[b[2],b[3]]],{padding:70,bearing:-14,pitch:36,duration:0});})()"

  # down on the business district, where the blocks read as blocks
  node tools/shoot.mjs "http://127.0.0.1:$PORT/" "$OUT/$CITY-core.png" \
    --wait 13000 --w 1600 --h 1000 --settle 3500 \
    --eval "(()=>{const c=$CORE;__map.jumpTo({center:c,zoom:16.1,pitch:62,bearing:-24});})()"
done
echo "done -> $OUT"
