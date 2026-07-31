#!/bin/bash
# Double-click this in Finder to play Broadway & Wall.
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then
  exec python3 serve.py
else
  echo "Python 3 is required. macOS: install it from python.org, or run: xcode-select --install"
  read -r -p "Press Return to close."
fi
