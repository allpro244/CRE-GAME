# Grok 4.5 queue — no playtest required

Work Brian can leave running overnight. **No merge required from Brian** for
agents to keep stacking PRs. Each item is harness-backed or move-only UI.

**Base tip:** `claude/realestate-game-claude-code-32bppd` (post-#84).  
**Do not start Fable 5** until the checklist at the bottom is all done (see
`FABLE5_PLAN.md`).

**Out of scope here:** #85 as stacked (broken firms test); ground-up cost/rent
retune (`e64b048`); graphics taste; onboarding polish.

---

## Already shipped (this chat)

| Item | Where |
|------|--------|
| Fresh playable + `popupsOff` delivery | #83 |
| Demand dynamism, build desk declutter, delivery zoom, Economy drift | #84 |
| Property desk split + Programme · Design · Financing tabs | #86 (open) |
| RightPanel → `panels/` split | earlier (`fc92340`) |

## Parked / do not merge

| Item | Why |
|------|-----|
| **#85** full stack | Last commit (`e64b048`) drops century firm min to 4 on seed 4242. Superseded by balances-only PR below. |

---

## Queue (do in order)

### G1 · Finish #86 ✅/in flight
- Branch: `cursor/ui-dev-revamp-d634`
- Rebased onto post-#84 tip
- Acceptance: `pnpm check` + CI smoke green
- Merge when Brian is ready (not blocking later Grok PRs if they stack on #86)

### G2 · DebtPage split
- Branch: `cursor/debt-split-d634` off tip (or off #86 if cleaner)
- Move-only: `TheBanks`, `SponsorRecord`, `CompsSheet`, `TheStreet`, `FundDesk`,
  `CreditLine`, `HousePolicy`, `Landlords` → `panels/debt/*.tsx` or sibling files
- `DebtPage.tsx` becomes a thin shell; re-export for imports
- Acceptance: `pnpm check`; no engine changes

### G3 · Playtest balances-only (safe half of #85)
- Branch: `cursor/playtest-balances-safe-d634`
- **Include** from `cf72836`: FAR_CEIL 3.8 + citygen headroom; industrial supply
  knobs; insolvency monthly seizures + `underwaterMs`; liquidity TI warning;
  refi fundable-desks UX; mild `DEV_MARGIN` / industrial hard-cost if still in
  that commit
- **Exclude:** `e64b048` (RENT_BASE / HARD_COST office-mf / DEV_MARGIN 0.10 /
  hurdle bare-cap retune)
- Port Refi UX onto `RefiDesk.tsx` if #86 landed
- Acceptance: `pnpm check` + `pnpm no-playtest` (esp. `firms` seed 4242 min ≥ 5)
- Update #85 PR body: superseded

### G4 · Seller predictability measurement (#33 / Phase 4.1)
- Branch: `cursor/seller-stats-d634`
- Extend `test/seller-stats.mjs`: histogram by seller kind, distress, rel decile
  (10 seeds × longer sample as plan allows)
- Report-only OK for this PR; engine changes deferred to Fable or a later Grok
  slice if tiny
- Acceptance: `pnpm seller-stats` green; printed report in PR body

### G5 · Distressed buyer UX (playtest item #6)
- Branch: `cursor/distress-idle-ux-d634`
- Surface waiting state when a distressed/motivated bid or approach is live
  (idle months, what happens next) — OfferDesk / inbox attention, not a new
  economy
- Acceptance: `pnpm check`; attention-route still green if touched

### G6 · HANDOFF backlog hygiene
- Restore / update player backlog section: mark shipped (#83/#84/#86 items),
  point open items at G3–G5 and Fable plan
- Point §7 at `NO_PLAYTEST_PLAN.md` + these two plan files
- Acceptance: docs only; can land with G2 or G3

### G7 · Phase 2 leftovers (only if gaps)
- Already present: `attention-route.mjs`, `rng-audit.mjs`, `check.yml`,
  `RAIL_AUDIT.md`, `seller-stats.mjs`
- Verify scripts are in `package.json` and HANDOFF mentions them; fix gaps only

---

## Explicitly deferred to Fable 5

The Station · Zoning depth · Tenant outgrows suite · Broker early look ·
Full firm entry/exit redesign · Ground-up economics retune · Century audit
overhaul · District silhouettes · Diversification investigation (#7)

---

## Done checklist (gate for Fable)

```
[x] G1 #86 CI green (merge optional) — #86 smoke SUCCESS
[x] G2 DebtPage split PR open (#89)
[x] G3 Balances-only PR open (#88) — firms 4242 min=7 locally
[x] G4 Seller-stats extended PR open (#90)
[x] G5 Distress idle UX PR open (#91)
[x] G6 HANDOFF updated (#87)
[x] G7 Phase 2 already on tip — N/A
[x] #85 marked superseded
```

When all boxes are checked, start `FABLE5_PLAN.md`.
