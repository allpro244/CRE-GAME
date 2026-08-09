# CRE Game

This repo contains one game: **Broadway & Wall**.

| Path | What it is |
|---|---|
| [`broadway-and-wall/`](broadway-and-wall/) | The game — engine, UI, pipeline, harness |
| [`legacy/groundwork/`](legacy/groundwork/) | Archived Groundwork scaffold (not in the workspace) |

## Start here

```bash
pnpm install
pnpm dev            # vite for broadway-and-wall
pnpm check          # engine harness
pnpm gate           # conservation / invariant gates
```

Docs for the game live under `broadway-and-wall/`:

- [`broadway-and-wall/README.md`](broadway-and-wall/README.md) — how to run and package
- [`broadway-and-wall/HANDOFF.md`](broadway-and-wall/HANDOFF.md) — traps, open faults, current state
- [`broadway-and-wall/CLAUDE.md`](broadway-and-wall/CLAUDE.md) — economy / engine rules
- [`broadway-and-wall/AGENTS.md`](broadway-and-wall/AGENTS.md) — agent brief

The design spec at the repo root (`broadway-and-wall-spec-v2.md`) is reference material for Broadway & Wall.
