# Restore point — before Cursor architectural refactor

Tagged at commit `24f69b4` on branch `cursor/cre-game-handoff-462d`.

Claude Code had finished; this is the tree immediately before Cursor’s
structural cleanup (RightPanel split, repo hygiene, naming, RNG streams,
clone path, conservation debt gap, street instruments, light engine seams).

## How to go back

```bash
# Look at the saved tree without changing your branch
git checkout restore/pre-cursor-refactor-462d

# Or reset your working branch to it (discards later commits on this branch)
git checkout cursor/cre-game-handoff-462d
git reset --hard restore/pre-cursor-refactor-462d

# Or make a new branch from the restore point
git checkout -b cursor/from-restore-462d restore/pre-cursor-refactor-462d
```

Tag (immutable pointer): `restore/pre-cursor-refactor-462d`  
Branch (same commit, easier to browse on GitHub): `restore/pre-cursor-refactor-462d`

Neither will receive further commits unless you push to them on purpose.
