# No-Playtest Queue — Implementation Plan

Work Brian can ship **without a manual playtest session**: harness-backed engine
changes, audit tooling, and optional graphics. UI polish that only validates
with human eyes stays out of scope here.

**Companion docs:** `HANDOFF.md` §6–7, `SKYLINE_CYCLES_PLAN.md` (complete),
`GRAPHICS_HANDOFF.md` (Phase 7 visuals).

**Execution:** one phase per PR where possible. Each phase ends with documented
measurements. Money-moving phases require `pnpm gate`; all phases require
`pnpm check`.

**Branch template:** `cursor/<slug>-d634` off
`claude/realestate-game-claude-code-32bppd`.

---

## Architecture principles

1. **Measure before you retire a rail.** `pnpm rails` and `tools/rails.mjs`
   exist because a clamp that binds >1–2% of ordinary months is load-bearing
   (see `CLAUDE.md`).
2. **No new RNG draw count** in hot paths without a re-roll note in the commit.
3. **Difficulty is output.** Do not add penalty sliders; add missing real risks.
4. **Comments are load-bearing.** Every measurement goes in the comment and the
   commit message.
5. **Playtest comes last.** Phases 1–6 are verifiable without Brian; Phase 7
   graphics need a screenshot pass eventually, not a century save.

---

## Phase 0 — Baseline (every PR)

| Task | Command |
|------|---------|
| Harness fresh | `pnpm install && pnpm engine` |
| Smoke | `pnpm check` |
| Record tip | `git log -1 --oneline` in PR body |

---

## Phase 1 — Close holder memory loop ✅

**Status:** merged (#68). Verification-only for agents picking up cold.

| Task | Detail |
|------|--------|
| Harness | `pnpm holder` — all acquire doors + book hang-up |
| Docs | `HANDOFF.md` §6 holder bullet closed |
| Spot-check UI | Marketplace `NOT TO YOU` chip; OfferDesk cold state |

**Done when:** `pnpm holder` green on tip; no open HANDOFF claims about
approaches-only memory.

---

## Phase 2 — Cold audits + CI (Track 6)

**Goal:** Catch regressions without human play. Cheap; do early in parallel with
Phase 3 measurement.

### 2.1 Inbox / attention routing audit

| File | Change |
|------|--------|
| `test/attention-route.mjs` | **New** — enumerate `attentionItems()` keys from a seeded 30y bot; assert every key has a non-empty `routeAttention()` with resolvable page or `auction` |
| `src/ui/attentionRoute.ts` | Fix any orphan prefixes found |
| `src/ui/InboxRail.tsx` | Ensure primary action uses same router |

**Acceptance:** harness passes; no `attentionItems` key maps to `{}`.

### 2.2 RNG discipline scan

| File | Change |
|------|--------|
| `tools/rng-audit.mjs` | **New** — diff `rng(` / `rrange(` call sites vs last tagged baseline commit; fail if hot-path files (`sim.ts`, `market.ts`, `rivals.ts`, `dev.ts`) gain calls without `RNG-NOTE:` in commit |
| `CLAUDE.md` or `HANDOFF.md` | One paragraph on how to run it |

**Acceptance:** clean scan on tip; documented workflow for agents.

### 2.3 GitHub Actions smoke

| File | Change |
|------|--------|
| `.github/workflows/check.yml` | **New** — `pnpm install`, `pnpm engine`, `pnpm check` on push/PR to `broadway-and-wall/**` |
| Optional nightly | `pnpm gate` on schedule (slow; ~3 min) |

**Acceptance:** PR shows green check; no secrets required.

### 2.4 Doc hygiene

| File | Change |
|------|--------|
| `HANDOFF.md` | Point §7 to this plan; keep §6 trap list current |
| `AGENTS.md` | Link `NO_PLAYTEST_PLAN.md` for post-skyline work |

**Done when:** `pnpm check` in CI; `pnpm attention-route` (new script) green.

---

## Phase 3 — Retire load-bearing rails (Track 2, HANDOFF #3)

**Goal:** Replace clamps that bind in normal play with mechanisms already in the
sim, one rail per PR.

**Do not start removing until Phase 3.0 measurement is written down.**

### 3.0 Measurement baseline (no code changes)

| Command | Purpose |
|---------|---------|
| `pnpm rails` | Default: 3 towns × 50y — which `clamp()` sites bind >1% |
| `BIND=0.02 pnpm rails` | Stricter “load-bearing” threshold |
| `N=6 HZ=720 pnpm rails` | Longer sample if a rail looks intermittent |
| Read | `dev.ts` ~2776 (order-book clamp history), `market.ts` ~2314 (vacGate note), `cycleDev` drift in `market.ts` `tickMacro` |

**Deliverable:** `RAIL_AUDIT.md` (or section in PR) listing top binders with
file:line, bind %, and proposed replacement.

### 3.1 `cycleDev` rail ✅ (this PR)

| File | Change |
|------|--------|
| `src/engine/market.ts` | Spring-loaded drift toward zero replaces hard pin at ±1 |
| `test/cycle-dev.mjs` | Assert `cycleDev` pinned ≤5% of months in 100y bot |

**Before:** `market:1527` bound 39.1% at ceiling (RAIL_AUDIT.md).  
**After:** re-run `pnpm rails` + `pnpm cycle-dev` on branch.

### 3.2 Development quota / `classAppetite` mirror rails

Historical fault: `e.starts` and `classAppetite` were the same formula (mirror,
not mechanism). `useForZone` now reads order-book composition — verify the
**pick clamp** at `dev.ts` ~2776 is not binding >2%.

| File | Change |
|------|--------|
| `src/engine/dev.ts` | Remove or widen clamp; ensure break composition reads `startOwed` only |
| `test/devyield.mjs` or new `test/orderbook.mjs` | Composition responds to fills; no permanent class lock |

### 3.3 Vacancy gate (if instrumented name still exists)

Comments reference retired `vacGate`; confirm no duplicate gating in
`classAppetiteE` + pipeline + retail glut. If a manual `Math.max/min` rail
still binds, replace with measured absorption (`absorption.ts`, `tickSpace`).

### 3.4 Jobs / firm-count ceiling

`firmEntryPitch` in `rivals.ts` (~1429) already uses product × leverage × thin.
Verify:

| Task | Detail |
|------|--------|
| `pnpm firms` | Raise hazard can say no; century firm count stable (~18–22 living) |
| Counterfactual | Document `product=1` run from comment block — still bounded? |

If an old hard cap remains elsewhere (grep `24 firms`, `Math.min(0.5`), refill
floor), remove it only with `pnpm firms` + `pnpm gate` green.

**Done when:** `pnpm rails` shows no clamp binding >2% in ordinary play for
retired sites; baseline moves explained in commit.

---

## Phase 4 — Seller predictability (#33, Track 4)

**Goal:** A seller’s behavior is legible from **kind + distress + relationship**,
not hidden reservation dice. Related IDEA_FEST #1–2 (broker/tenant) stay out
unless they fall out naturally.

### 4.1 Measure current acceptance surface

| File | Change |
|------|--------|
| `test/seller-stats.mjs` | **New** — 10 seeds × 50y: histogram of `bidOdds` outcomes by seller kind, distress flag, `relMult` decile |
| `src/engine/acquire.ts` | Export `reservationOf` stats helper for harness (test-only export ok) |

**Acceptance:** report printed; no code change required in 4.1.

### 4.2 Tape / listing path (`bidOdds`, `buyListing`)

| File | Change |
|------|--------|
| `src/engine/actions.ts` | Ensure `RESERVE_MID` / `RESERVE_SD` vary by seller kind + distress (already partial); document in comment |
| UI (optional) | `ParcelDesk` OfferDesk hint: “Typical closing range X–Y% of ask” from kind — **only if** engine exposes a band |

**Acceptance:** at 95% of ask, median accept rate ≈ coin-flip for voluntary
sellers (per existing comment); insult path fires at documented threshold.

### 4.3 Negotiation path (`negotiate`, `reservationOf`)

| File | Change |
|------|--------|
| `src/engine/acquire.ts` | Reduce opaque concession randomness where `theirPrice` already encodes seller kind |
| `test/seller-stats.mjs` | Round-trip: lowball → insult → cold holder uses same thresholds as tape |

**Acceptance:** `pnpm holder` still green; `pnpm check`; no new RNG in hot path
without note.

---

## Phase 5 — Zoning depth (#36, Track 3)

**Goal:** Zoning is a **value event** you can read and plan around; not just a
lens tint. Core file: `src/engine/zoning.ts` (rezoning, variance, landmark).

### 5.1 Engine completeness

| Mechanism | Files | Gap to close |
|-----------|-------|----------------|
| District rezoning | `zoning.ts` `tickZoning` | Wire scarcity already started — add harness for up/down frequency vs vacancy |
| Variance | `zoning.ts`, `actions.ts` | Player filing → hearing → grant/deny; odds on `GameState` |
| Landmark | `zoning.ts`, `types.ts` | Permanent envelope freeze + rent premium (`absorption.ts` already +6%) |
| Envelope read | `value.ts`, `dev.ts` | `planDevelopment` / FAR clamp vs `zoneAdj` / `variance` |

| File | Change |
|------|--------|
| `test/zoning.mjs` | **New** — seeded city: filing variance → decision month; rezoning moves `zoneAdj`; landmark blocks demo |
| `src/engine/invariants.ts` | Already has zoning section — extend if new fields |

**Acceptance:** `pnpm gate`; invariants clean; variance grant changes developable
SF on a fixed lot (asserted in harness).

### 5.2 Map / desk (minimal, no redesign)

| File | Change |
|------|--------|
| `src/map/MapView.tsx` | Zoning lens: show spent vs remaining envelope (feature-state `room` exists) |
| `src/ui/panels/ParcelDesk.tsx` | Land desk: link to variance filing when assembled site exceeds FAR |
| `src/ui/panels/ResearchPage.tsx` | District table: last rezoning month / direction |

**Acceptance:** `pnpm check`; playtest deferred for copy polish only.

---

## Phase 6 — Firm entry / exit (#48 / #49, Track 5)

**Goal:** Firm count is an **output** of deal flow and genealogy, not a refill
rail. Much of the mechanism exists in `rivals.ts` (`firmEntryPitch`, founder
spinouts).

### 6.1 Exit path audit

| File | Change |
|------|--------|
| `src/engine/rivals.ts` | Confirm failure → receiver → package sale → firm dead; no zombie firms |
| `test/firms.mjs` | Extend: living count band over 100y; `spawnedFrom` populated on spinouts |
| `src/engine/invariants.ts` | Rival with `failedM` has no active acquisitions |

### 6.2 Entry path audit

| File | Change |
|------|--------|
| `rivals.ts` | Founder bids (`founderBids`) fire when senior staff leave — wire if stubbed |
| `HANDOFF_PRINCIPAL.md` §5 | Align with implementation (genealogy on league table) |
| `test/firms.mjs` | Assert pitch → 0 when `product` term → 0 (crowded market) |

### 6.3 UI (read-only, harness-first)

| File | Change |
|------|--------|
| `src/ui/panels/ResearchPage.tsx` | Street tab: `spawnedFrom` lineage (“raised out of X”) |
| News | Already prints spinout — ensure consistent |

**Acceptance:** `pnpm firms` green; century sim firm count within documented band;
no hard `24 firms` cap remains.

---

## Phase 7 — District silhouettes (Track 7, optional / parallel)

**Goal:** Millside vs Exchange **read differently from the air** without
touching economy. Follow `GRAPHICS_HANDOFF.md`; **no `src/engine/` money
changes.**

| File | Change |
|------|--------|
| `src/citygen/citygen.mjs` / `island.mjs` | District tag → massing priors (height variance, footprint aspect) |
| `src/map/ThreeBuildings.ts` | District-aware roof/crown selection weights |
| `tools/shoot.mjs` | Before/after screenshot for one seed |
| `test/citygen-variety.mjs` | Extend: Exchange median height > Millside median on same seed |

**Acceptance:** `pnpm variety` or new check passes; `tsc` clean; screenshot in
PR; **no** `pnpm gate` requirement unless engine touched by mistake.

---

## Suggested PR order

| PR | Phase | Risk | Needs playtest? |
|----|-------|------|-----------------|
| A | 2 — CI + attention-route | Low | No |
| B | 3.0 — rail audit doc only | None | No |
| C | 3.1 — one rail retirement | High | No (harness) |
| D | 3.2–3.4 — further rails | High | No |
| E | 4 — seller predictability | Medium | Optional |
| F | 5 — zoning depth | Medium | Optional (copy) |
| G | 6 — firm entry/exit | Medium | No |
| H | 7 — silhouettes | Low | Screenshot only |

Phases 3–4–5–6 can overlap **measurement** (Phase 3.0, 4.1) in one agent turn;
**implementation** stays one rail / one system per PR.

---

## Testing matrix

| Phase | Required |
|-------|----------|
| 0 | `pnpm check` |
| 1 | `pnpm holder` |
| 2 | `pnpm check` + new harness scripts |
| 3 | `pnpm rails` before/after + `pnpm gate` + `pnpm baseline:check` (explain moves) |
| 4 | `pnpm holder` + `pnpm seller-stats` |
| 5 | `pnpm gate` + `test/zoning.mjs` |
| 6 | `pnpm firms` + `pnpm gate` |
| 7 | `pnpm variety` / shoot script; no gate |

---

## Explicitly out of scope

- Skyline / HUD / onboarding polish (needs Brian’s eyes)
- Difficulty sliders or casual mode
- Promoting lettered `pnpm report` tests to gate
- Scenario campaigns
- Groundwork / root `src/` restoration

---

## Agent checklist

```
[ ] Branch off claude/realestate-game-claude-code-32bppd
[ ] pnpm install && pnpm engine && pnpm check
[ ] Phase 1 — verify pnpm holder on merged tip
[ ] Phase 2 — CI + attention-route + rng-audit
[ ] Phase 3 — measure rails, then one rail per PR
[ ] Phase 4 — seller-stats + predictability
[ ] Phase 5 — zoning.mjs + desk hooks
[ ] Phase 6 — firms harness + genealogy UI
[ ] Phase 7 — silhouettes (optional)
```
