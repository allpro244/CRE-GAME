# Broadway & Wall — agent brief

This directory is the game. The older Groundwork scaffold is archived under
`legacy/groundwork/` (outside the pnpm workspace); work here, not there.

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

Also read **`HANDOFF.md`** before engine work — traps first (RNG re-roll,
stale bundle, frozen world, conservation blind spot, one-quantity-two-answers),
then open faults. Re-measure before believing anything in it.
Do not open pull requests unless the owner asks.

## Harness (gitignored — rebuild on every fresh clone)

```bash
pnpm install
pnpm engine          # writes test/.entry.ts + test/.engine.mjs
pnpm gate            # conserve + extleak + city invariants
pnpm check           # fresh + conserve + baseline:check
```

Never probe with a stale `test/.engine.mjs`. `test/fresh.mjs` guards this.

## Ownership

Cursor owns the working tree. Claude Code handed off at
`claude/phase-1-implementation-v4c2az` @ `8480967` (handoff rewrite at
`e91fd6d`). Active work continues on `cursor/cre-game-handoff-462d` (or later
`cursor/*-462d` branches) off that tip.
