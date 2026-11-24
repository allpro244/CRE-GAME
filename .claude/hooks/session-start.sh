#!/bin/bash
# SESSION START: work from the latest main, every time.
#
# Why this exists (2026-11-24): a cloud session cloned the repo's GitHub
# default branch, which was an old branch frozen at PR #474 while main was at
# #855. A whole realism audit ran on code 853 commits stale before anyone
# noticed. AGENTS.md already says "start every branch from the latest
# origin/main"; this makes it happen instead of relying on memory.
#
# What it does, in order:
#   1. fetch origin/main;
#   2. if the current branch has no commits of its own that main lacks and the
#      working tree is clean, move it onto origin/main (nothing is lost: every
#      commit on it is already in main);
#   3. otherwise leave it alone and print a loud warning saying how far behind
#      it is, so the agent merges main before measuring or changing anything;
#   4. install dependencies (only when the lockfile changed) and rebuild the
#      engine bundle, so no probe runs against a stale test/.engine.mjs.
# Whatever it printed lands in the agent's context at session start.
set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0   # local checkouts are the owner's to manage
fi

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

say() { echo "[session-start] $*"; }

# --- 1. fetch main ------------------------------------------------------------
fetched=0
for delay in 0 2 4 8; do
  sleep "$delay"
  if git fetch --quiet origin main 2>/dev/null; then fetched=1; break; fi
done
if [ "$fetched" != 1 ]; then
  say "WARNING: could not fetch origin/main. Run 'git fetch origin main' and check 'git rev-list --count HEAD..origin/main' before doing any work."
else
  branch="$(git rev-parse --abbrev-ref HEAD)"
  main_sha="$(git rev-parse --short origin/main)"
  main_subj="$(git log -1 --format=%s origin/main)"
  behind="$(git rev-list --count HEAD..origin/main)"
  ahead="$(git rev-list --count origin/main..HEAD)"
  dirty="$(git status --porcelain --untracked-files=no)"

  # --- 2/3. get onto main, or say loudly why not -------------------------------
  if [ "$behind" = 0 ]; then
    say "OK: '$branch' already contains the latest origin/main ($main_sha: $main_subj)."
  elif [ "$ahead" = 0 ] && [ -z "$dirty" ]; then
    if [ "$branch" = "HEAD" ]; then
      git checkout --quiet --detach origin/main
    else
      git checkout --quiet -B "$branch" origin/main
    fi
    say "UPDATED: '$branch' was $behind commits behind origin/main and had no work of its own; it now sits on origin/main ($main_sha: $main_subj)."
  else
    say "WARNING: '$branch' is $behind commits BEHIND origin/main ($main_sha: $main_subj) and has $ahead commit(s) of its own${dirty:+ plus uncommitted changes}."
    say "WARNING: do not measure, test or change anything until main is merged in: 'git merge origin/main' (AGENTS.md: work from the latest main)."
  fi
fi

# --- 4. dependencies and the engine bundle -----------------------------------
hashes=node_modules/.session-start.sha256
if ! sha256sum --check --status "$hashes" 2>/dev/null; then
  rm -f "$hashes"
  if pnpm install --frozen-lockfile >/dev/null 2>&1 || pnpm install >/dev/null 2>&1; then
    sha256sum .claude/hooks/session-start.sh package.json pnpm-lock.yaml pnpm-workspace.yaml broadway-and-wall/package.json 2>/dev/null > "$hashes" || rm -f "$hashes"
  else
    say "WARNING: 'pnpm install' failed; run it by hand."
  fi
fi
if pnpm engine >/dev/null 2>&1; then
  say "engine bundle rebuilt (broadway-and-wall/test/.engine.mjs)."
else
  say "WARNING: 'pnpm engine' failed; rebuild the bundle before running any probe."
fi
exit 0
