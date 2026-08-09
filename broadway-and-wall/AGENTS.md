# Broadway & Wall — agent brief

This directory is the game. The repo root holds an older Groundwork scaffold;
work here, not there.

## Standing rules (required reading)

Read and follow **`CLAUDE.md`** in this directory before changing the economy,
engine, or anything that moves money. Short version:

- Realism outranks preference — including difficulty preferences.
- Difficulty is an output of honest risk, not a dial or penalty multiplier.
- No fake numbers: no coefficients chosen to make a median look right; prices
  are discovered by mechanism; one quantity cannot have two answers.
- `pnpm gate` must pass before committing anything that moves money.
- `pnpm check` (~20s) after engine work; if a baseline metric moves, say why
  in the commit message.

Also read **`HANDOFF.md`** for the current backlog and what is already done.
Do not re-open pull requests unless the owner asks.

## Harness (gitignored — rebuild on every fresh clone)

```bash
pnpm install
pnpm engine          # writes test/.entry.ts + test/.engine.mjs
pnpm gate            # conserve + extleak + city invariants
pnpm check           # fresh + conserve + baseline:check
```

Never probe with a stale `test/.engine.mjs`. `test/fresh.mjs` guards this.

## Parallel work

Claude Code often works on `claude/phase-1-implementation-v4c2az`, mostly
`src/engine/` and `src/ui/RightPanel.tsx`. Prefer a feature branch off that tip
and stay out of those files unless coordinating. Fetch before merging.
