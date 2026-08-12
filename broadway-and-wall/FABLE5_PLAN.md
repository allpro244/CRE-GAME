# Fable 5 plan — wait for Grok

**Do not start this plan until every box in `GROK_QUEUE.md` “Done checklist”
is checked.** Grok is clearing UI splits, safe playtest balances, and thin
harnesses so Fable’s big systems land on a clean tip.

**Model:** Claude Fable 5 (Claude Code credits).  
**Base tip when starting:** whatever `claude/realestate-game-claude-code-32bppd`
is after Grok PRs merge (or after Grok branches are merged into that tip).  
**Product root:** `broadway-and-wall/` only. No Groundwork.  
**No playtest required** — harness acceptance only.  
**Do not push** to `claude/game-commit-playtest-mnc8ty`.

---

## Standing brief (paste into every Fable session)

```
Read broadway-and-wall/CLAUDE.md, HANDOFF.md, GROK_QUEUE.md (must be complete),
and this FABLE5_PLAN.md.

Work only under broadway-and-wall/.
One phase per PR. Branch: cursor/<slug>-d634 off the current tip.
Measure before claiming success. Money-moving work needs pnpm gate.
No difficulty sliders. Difficulty is an output.
Do not re-open ground-up HARD_COST/RENT_BASE retunes unless firms + pencils
+ breakeven harnesses all pass on ≥2 seeds.
Comments and commit messages carry measurements.
```

---

## Campaign order (one PR each)

### F1 · The Station (IDEA_FEST #3) — grand fantasy
**Goal:** Infrastructure rumors → announcement → opening that move block demand
and land, using existing `demand.ts` propagation.

| Deliverable | Detail |
|-------------|--------|
| Engine | Event types on `GameState`; tick that advances rumor→open; `nudgeBlockDemand` / landAdj along alignment |
| News | Named station/park/bridge copy |
| Harness | `test/station.mjs` — seeded city: after open, median land or blockD within radius rises vs control |
| UI (minimal) | News click focuses map; Research one-liner optional |

**Acceptance:** `pnpm check` + new harness; no RNG draw-count blowup without note.

### F2 · Zoning depth (#36 / NO_PLAYTEST Phase 5)
**Goal:** Variance filing → hearing → grant/deny; rezoning as readable value
event; landmark freezes envelope.

| Deliverable | Detail |
|-------------|--------|
| Engine | Complete gaps in `zoning.ts` / `actions.ts` per plan |
| Harness | Extend `test/zoning.mjs` — grant changes developable SF on fixed lot |
| Desk | Land / Develop: “file variance” when site exceeds FAR |
| Map | Zoning lens shows spent vs remaining envelope if feature-state exists |

**Acceptance:** `pnpm gate` + zoning harness.

### F3 · Tenant who outgrows the suite (IDEA_FEST #2)
**Goal:** Growing `t.staff` tenants ask for more space; shrinking ask to give
back — decision, not flavor.

| Deliverable | Detail |
|-------------|--------|
| Engine | Monthly scan → offer on holding; accept/decline actions |
| Harness | Force a growing tenant; assert offer appears; accept grows suite or decline risks leave |
| UI | Modal or desk row — keep thin |

**Acceptance:** `pnpm check` + harness; conserve still green if cash moves.

### F4 · Broker who calls you first (IDEA_FEST #1)
**Goal:** Named house broker memory; early look at listings before tape.

| Deliverable | Detail |
|-------------|--------|
| Engine | Per-broker relationship; threshold → private window on listing |
| Harness | After N fees, listing visible off-tape; cold/ignore decays score |
| Related | Align thresholds with #33 seller work |

**Acceptance:** `pnpm holder` + new broker harness still green.

### F5 · Firm entry / exit (#48/#49) — after F1–F2
**Goal:** Living firm count is output of deal flow + genealogy, not a refill
rail. **Do not** paper over with a hard min floor.

| Deliverable | Detail |
|-------------|--------|
| Measure | Century firm series on seeds 7777 + 4242 before changes |
| Engine | Exit zombies; entry pitch product term; spinout genealogy |
| Harness | `pnpm firms` — document band; no silent cap at 24 |

**Acceptance:** `pnpm firms` + `pnpm gate`; write measurements in commit.

### F6 · Optional later
- Ground-up economics retune (only with pencils + breakeven + firms green)
- Diversification (#7) investigation — measure strategy vs economy first
- District silhouettes (Phase 7 graphics) — screenshot via `tools/shoot.mjs`
- Century audit / `pt-econ` report overhaul

---

## What Fable must not do

- Merge or continue #85’s `e64b048` without a full A/B
- Touch UI warehouse splits (Grok owns those)
- Add casual / easy mode
- Change RNG call counts in hot paths without `RNG-NOTE:` and re-baseline

---

## Suggested Fable PR titles

1. `feat(engine): stations and infrastructure value events`
2. `feat(zoning): variance hearings and envelope depth`
3. `feat(leasing): tenant expansion and contraction asks`
4. `feat(acquire): house broker early looks`
5. `feat(rivals): firm entry/exit as market output`
