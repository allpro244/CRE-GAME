# Agents — read this first

**This repository is Broadway & Wall only.**

- The game code is in **`broadway-and-wall/`**.
- Do **not** create, restore, or work on Groundwork. That product is gone.
- Do **not** treat a root-level `src/` tree (or anything named Groundwork /
  New Amsterdam / Meridian) as the active game — that is a stale branch tip.
- Preferred working branch family: `cursor/cre-game-handoff-462d` and later
  `cursor/*` branches cut from it.
- Before engine or economy work: `broadway-and-wall/CLAUDE.md` and
  `broadway-and-wall/HANDOFF.md`.
- Commands from the repo root (`pnpm dev`, `pnpm check`, `pnpm gate`) already
  delegate into `broadway-and-wall/`.
- Cloud Agent bootstrap from repo root: `pnpm install` then `pnpm engine`
  (rebuilds `broadway-and-wall/test/.engine.mjs`). Dev server:
  `pnpm dev --host 0.0.0.0 --port 5173`. Smoke: `pnpm check`.

If your checkout does not contain `broadway-and-wall/`, you are on the wrong
ref. Stop and check out `cursor/cre-game-handoff-462d` (or the owner’s current
Broadway & Wall tip) before making changes.
