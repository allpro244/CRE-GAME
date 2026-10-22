# Broadway & Wall — master to-do

Owner: chief of staff (Claude). Updated 2026-10-21 evening. Integration branch:
`claude/region-preview` (region map, land dev, homebuilding, commerce, perf).
Each item: **who** · status. "You" = the owner.

## A. Blocking / needs you
1. **Merge PR #411 on GitHub** — its CI "smoke" job runs the whole suite and has sat >4 h; my merges are blocked by the CI gate. Everything behind it (#413 #414 #415 #416, the region branch) waits on it. · **You** (tap Merge) — or tell me to make CI fast (A2).
2. **Make CI a smoke test, not the full suite** (minutes, not hours) so PRs can land. · Me · not started
3. **Fab asset packs** — houses, retail/strip/grocery/big-box, warehouses/trucks, farm buildings, US road kit. · **You** · I import once they're in your library

## B. In progress (agents)
4. **CRITICAL money pump: R-2 lots valued as apartment sites** (+$5.3M phantom net worth) — R-2 = single-family only; one lot value everywhere; regression test. · Phase 3 agent
5. **Remove player homebuilding**; player sells lots to builders only (offers, listing a plat, expected bids/take-down). · Phase 3 agent
6. **Rezoning refile wait** (~12 months after refusal), stale "zoned for agriculture" text, sell-out pace 13.7/mo check. · Phase 3 agent
7. **Land development design desk** — editable plat map, lot mix, street patterns, parks/amenities with cited premiums, live P&L, A&D loan. · Plat-design agent
8. **Growth sim (Phase 4)** — households drive subdivision; rivals platting; downtown redevelops fringe houses; upzoning with lag; commerce follows rooftops; county/state roads over time. · Phase 4 agent
9. **Buildable retail & industrial product types** — pad, strip, neighbourhood/community/power centre, flex, warehouse/DC, manufacturing, industrial park plats; anchors/co-tenancy. · Product-types agent
10. **UI revamp steps 5–8** — replace classic Rent roll/Money/Market/Capital; Settings›Buying; refinance quotes; Unreal lens bridge; year review; short toasts; land-dev views in Holdings/Inbox; rebase onto region branch. · UI agent
11. **Region month under 250 ms** (now ~300 ms; was 1,000) and game start under 2 s. · Engine-speed session

## C. Gaps left by finished work (to assign next)
12. **Rival homebuilders off-book** — need cash/debt/failure like commercial rivals. · Phase 3 agent (queued)
13. **New houses not real** — not drawn on map/Unreal, not in housing stock, never resell. · Phase 3 agent (queued)
14. **Existing-house valuation ~10× local incomes** (land not scaled to town money) — base engine inconsistency. · Phase 3 agent (queued)
15. **Conserve coverage: `fees NO` on region** — the gate may exit non-zero; verify against base and fix the bot or the category. · Me
16. **Farmland price checks** — appraisal $71–80K vs assessed $164K vs ask $172K on the same tract (two answers). · Me
17. **No regional mall ever spawns** (seed 3 qualifies, no site); seed 1 industrial park only 72 ac; gas stations crowded out by strips. · Region agent
18. **Region demand misses transit/second-centre terms** (44 of 100 points read zero) — needs a car-access term. · Region agent
19. **Freeway reuse through town** (verges, parking, 1970s buildings) not modelled. · Backlog
19a. **Retail kit (RetailBuilder) rough edges** — pad stalls still park against store fronts; QSR/bank side lanes only partly kept clear; grocery vestibule reads dark; text is lit-colour not emissive at night; no cart corrals out in the lot; pylon only per centre (pads have pole signs). Next: same kit approach for houses and industrial (dock doors, trailers, columns already in /Game/BW/Kit). · Me
20. **UI speed P5** (no blur/animation in Unreal) never measured inside Unreal. · UI agent
21. **Streetscape leftovers** — pale-blue wedges near parks (cause unknown), signals are posts only (no mast arms), no snow. · Visuals pass (later)
22. **Hedgerows and farmsteads** skipped. · Visuals pass (later)
23. **Retail building detail** — real storefronts/signage, loading docks, pylon signs drawn (deco "sign" volumes exported, not yet drawn). · Visuals pass / assets
24. **Houses look bad** — procedural stopgap until Fab pack. · Visuals pass / assets
25. **Roads look bad** — region roads read brown; rural shoulders; markings. · Visuals pass / assets

## D. Merges and builds
26. Land #411 → #413 → #414 → #415 → #416, then a PR for `claude/region-preview` (with Phases 1–4, commerce, plat desk, product types) into main. · Me (after A1/A2)
27. Packaged build with the region game. · Me — last one (`D:\Builds\BroadwayWall-new`) predates the region
28. Close stale PRs #211, #256 (months old). · Me, with your OK
29. Discard the dead web-fix session's uncommitted edits (obsolete; those tests pass now). · Me

## E. Next phases (REGION_PLAN §7)
30. **Phase 5: rendering at scale** — aggregate distant neighbourhoods, LOD, 60 fps on the new PC (arrives Oct 26; RTX 5070 Ti, enable frame generation).
31. **Jurisdictions** — town vs county rules, different fees/approval odds.
32. **Build-to-rent** (owner deferred).
33. **Rivals entitling/platting** (part of Phase 4) and phased infrastructure (build a plat in sections).

## Done today (for the record)
Region map (6×6 km, graded lot sizes, retail/industrial hierarchy, industrial park, truck stop) · land dev (buy→entitle→plat→sell) · homebuilder lot residuals · plat yield 10–49% → ~63% · region generation 5.3 s → 2.1 s · month 1.0 s → 0.3 s · game start 11 s → 3.6 s · car parks with stalls/cars/islands/lights · farm Build-tab bug · raise test · PR #412 merged.
