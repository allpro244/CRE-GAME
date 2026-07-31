#!/bin/bash
# Run ./play.sh to play Broadway & Wall.
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then
  exec python3 serve.py
else
  echo "Python 3 is required (apt install python3, dnf install python3, ...)."
  exit 1
fi
