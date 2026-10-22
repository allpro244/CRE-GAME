# Agents — read this first

## Stay on course (owner's standing rule)

Run the **course check** (`.claude/skills/course-check/SKILL.md`, the
`course-check` skill) **often**:
- before starting a task;
- before waiting on anything slow;
- every ~30 minutes of work;
- after any surprise;
- before saying something is done.

At minimum, ask yourself:
- **Am I doing this as efficiently as possible?**
- **Will this get us to the end goal in the best way?**
- **Could I be doing this better, or is there something more important?**
- **Am I waiting on something?** What's the deadline, and what am I doing meanwhile?
- **How do I know it works?** Seen, not assumed.
- **Is finished work landing** (small PRs, merged), and does the owner know?

Act on every "no" immediately. Never leave a job running past about 2× its
expected time. Never hand the owner something you could do yourself.


**This repository is Broadway & Wall only.**

**The game is moving to Unreal Engine 5.8 (owner's decision, 2026-10-19).
Read `UE58_PLAN.md` first.** The web build in `broadway-and-wall/` is frozen:
no new features, economy rounds or UI work. Its economy engine
(`broadway-and-wall/src/engine/`), city generator and tests are reused
unchanged by the Unreal game; touch them only when the Unreal work needs it,
and keep `pnpm check` green when you do. The Unreal project lives in
`unreal/`.

- The game code is in **`broadway-and-wall/`**.
- Do **not** create, restore, or work on Groundwork. That product is gone.
- Do **not** treat a root-level `src/` tree (or anything named Groundwork /
  New Amsterdam / Meridian) as the active game — that is a stale branch tip.
- Work from **`main`**. Start every new branch from the latest `origin/main`,
  merge `main` back in before you open a PR, and land work by PR into `main`.
  Do not stack parallel feature branches off an old base. Cursor is no longer
  used: the `cursor/*` branches are months-old history, not working tips.
- Before engine or economy work: `broadway-and-wall/CLAUDE.md` and
  `broadway-and-wall/HANDOFF.md`.
- Before debt, lender or rival-debt work: `broadway-and-wall/BANKING.md`
  (the loan book, the price law, and the handoff for rival per-loan debt).
- Post-skyline / no-playtest queue: `broadway-and-wall/NO_PLAYTEST_PLAN.md`.
- Developer-only play (MDGA — Make Development Great Again): `broadway-and-wall/MDGA_PLAN.md`;
  instruments in `broadway-and-wall/tools/mdga/`.
- Commands from the repo root (`pnpm dev`, `pnpm check`, `pnpm gate`) already
  delegate into `broadway-and-wall/`.
- Cloud Agent bootstrap from repo root: `pnpm install` then `pnpm engine`
  (rebuilds `broadway-and-wall/test/.engine.mjs`). Dev server:
  `pnpm dev --host 0.0.0.0 --port 5173`. Smoke: `pnpm check`.

If your checkout does not contain `broadway-and-wall/`, you are on the wrong
ref. Stop and check out `main` before making changes.
