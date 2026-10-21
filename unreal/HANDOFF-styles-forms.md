# Handoff: building styles, forms and slenderness (2026-10-20 night)

The owner wants buildings to look great: realistic NYC, nothing bland, nothing silly. Rule: always look at renders, and scrap or fix anything that looks off. Short phone-friendly messages. Full autonomy, including merging.

## Nothing is committed yet
- Branch `claude/ue58-city-kits-build` is already merged.
- Start a new branch from origin/main, then commit all of the work below.
- Commit trailers per memory/system: no model names; City Sample content is never committed.

## 1. Facade styles (done, needs commit and wiring)
**Generator:** `unreal/tools/make-styles.py`, with recipes in `unreal/tools/styles.json`.
- 56 styles: B01–B57, minus B24 (scrapped).
- Run: `UnrealEditor-Cmd.exe <uproject> -run=pythonscript -script="unreal/tools/make-styles.py unreal/tools/styles.json unreal/BroadwayWall/Data [KEYS]"`.
- Writes `Data/kit-<KEY>.json` and meshes in `/Game/BW/Styles/<KEY>/v<timestamp>/`. Folders are versioned because a running game locks the files; old versions are pruned when free.

**Reviews:**
- B01–B40 got two-lens reviews (results in `scratchpad/stylereview.json`). All 39 patches are applied to styles.json; families are in each recipe.
- B41–B57 are new designs from a critic-checked workflow and are not reviewed yet.

**Generator-features workflow** (run wf_d2a852b8-27f; may still be running):
- Adds to make-styles.py: rustication fix, mansard, orders, setback crown, corner windows, spandrel patterns, mullion caps, stagger/loggia and rotated sawtooth.
- When it finishes: read its journal, check that make-styles.py parses, then regenerate everything.

**Generator bugs still TODO in make-styles.py:**
- Fire-escape stair stringer: `M.box(4, 76, 80, y0+20, y0+20+W*0.55, 5, H)` is a solid sheet. Make it two thin rails.
- Write `"every": 4` on the Typical_1 feature module when there is a recipe feature and not `feature_all`. The C++ side is done (`FBWKitModule.Every`).
- Arch heads are 8 steps and look sawtoothed up close: use more steps or an extruded polygon.

**Then:**
1. Regenerate all styles.
2. Render: `-KitThumbs -KitFloors=12 -ShotOnly=kit-B` (wide), plus `-KitZoom=0.3` (close).
3. Re-review, then make thumbnails (`-KitThumbs` at the default 6 floors into `Data/kit-thumbs`).
4. Run `node unreal/tools/style-kits.mjs`, which writes `src/engine/styleKits.ts`. Append STYLE_KITS to KITS in `renderView.ts` and remove CHD/SFB from KITS (retired to `Data/retired/`).
5. Run `node unreal/tools/facade-families.mjs`, which merges recipe families so the city uses the styles.
6. Remove the "Windows" section from `src/ui/panels/DesignPicker.tsx`. The C++ already ignores Look.Bays.

**City Sample kits:**
- 14 of 16 kept.
- `grid` overrides: CHB 250, CHF 400, NYA 175, SFA 975 (kit JSON `grid` field, read in FBWKit::Load).
- Palette now drops deep light-court return pieces.

## 2. Unreal C++ changes this session (built, uncommitted)
- FacadeBuilder:
  - base + one shaft + top stacking;
  - fit filter;
  - grid override;
  - feature `Every`;
  - upper tiers (`!bGround`) skip the base bands;
  - sliver walls get plain corner wall;
  - the window rhythm setting is ignored.
- CityBuilder: Dress seed = hash(Bbl) only, so every tier of a building shares one rhythm.
- BWGame:
  - `-KitZoom=` close-ups;
  - KitThumbs uses a big square lot;
  - `-LookFile=views.json` (name, x, y, z, yaw, pitch, dist).
- CityLife: LIFE tick log removed.
- Earlier, uncommitted: exposure per weather, roof-rim removal, `-KitFloors`.

## 3. Building forms (massing), the owner's big new ask
- Forms live in `src/citygen/massing.mjs` (massingStack, ~25 families). `families: [name]` forces one.
- Gallery tool: `node unreal/tools/form-gallery.mjs <city> <out-city> <out-looks>`. Then run the game with `-City=<out> -LookFile=<looks> -NoCrowd -Shots=<dir>`.
- Latest renders: `unreal/shots/forms4` (with the tier fix). Older ones: forms3.
- Owner verdict: the tall late-modern forms (chamfertaper, twist, telescope, shifted, podium) look dumb, as pencil towers. Scrap them or fix them.

**TODO NOW, the slenderness rule in massing.mjs:**
- Edit `done()` at about line 292: reject a form (return null, so it falls back to a plain building) if any tier with top > 22 m has a narrow width below 12 m (15 m for office), or top / narrow width > 8.
- Use `narrowWidth` from citygen.mjs, or copy the rotating-calipers helper.
- Basis: CTBUH/NYC call "super-slender" 1:10 and up; ordinary towers run 1:5–1:8 (WTC 1:6.6, Seagram ~1:5.8).
- Then re-export the city (`node unreal/tools/export-city.mjs --size metro --seed 1`), re-run the gallery and look.

**Workflows with results to read:**
- `forms-realism-audit` (run wf_996d9e72-e53): per-form keep/fix/scrap, lot table, slenderness audit with calibrated rules.
- `building-forms-catalog` (run wf_c01861ba-334): catalog plus implementation plan (form picker on the Build desk, economics, preview).
- Results: `C:\Users\Brian\.claude\projects\D--Projects\e41b8ba6-...\subagents\workflows\<run>\journal.jsonl`.
- Turn the catalog into an owner-facing page with examples.

## 4. City generator plan 13 (done, uncommitted)
- `PLATE_MIN_M` is office 15 / other 12 in citygen.mjs, with CITY_PLAN = 13. city-accept passes.
- `test/raise.mjs`: the instant-raise block now tries seeds 9402/9401/9405. The raise test passed after this.
- A background run of the rest of `pnpm check` was writing to `D:/Projects/CRE-GAME/rest.log` (FAIL lines) and `baseline.log`. Check both. If the baseline moved, regenerate it deliberately (`pnpm baseline`) and give the reason in the commit (plan 13 city change).
- Don't edit `broadway-and-wall/src` while tests run: the fresh-bundle guard fails.

## 5. Other sessions
- **Streetscape** (local_cf49a8fb…): works on everything outside buildings, in the same folder, uncommitted. It was told its street-level shot was black. Read its report and before/after (`unreal/shots/street-before`, `street-after`).
- A stray `node tools/econaudit.mjs` (PID 24548) has been running since 08:44. The owner was asked whether to kill it; no answer yet.

## Gotchas
- Build fails while any UnrealEditor.exe runs the game (DLL lock). The streetscape session also runs the game; wait for it, and don't kill its processes.
- PIL is installed. Contact sheets: `scratchpad/sheet.py out.jpg cols x0,y0,x1,y1 files...`
- The owner's PC is an i9-9900K / RTX 2080 8 GB; a new 9800X3D / 5070 Ti machine is coming.

## Update, overnight 2026-10-21
- Committed WIP on branch `claude/building-styles-forms` (pushed). Commit again after each round.
- Massing anti-pencil rule is in (massing.mjs `done()`: tiers above 22 m need narrow width >= 12 m, or 15 m for office, and slenderness <= 1:8). The city is now no thinner than 1:2.8.
- 70 styles (B01-B71 minus B24). Contemporary set B58-B71 (group "contemporary"), wired into the Build desk: `src/engine/styleKits.ts` comes from `unreal/tools/style-kits.mjs`; `renderView.ts` KITS spreads STYLE_KITS; KIT_GROUPS gains Contemporary; CHD/SFB are removed.
- The Windows setting is removed from DesignPicker. FacadeBuilder now uses ONE window piece per building (Rhythm {0}); only `Every` feature bays break the run.
- New generator features:
  - fire-escape slats and thin stringers, `every` 4;
  - smooth arches with archivolt and keystone;
  - two-storey staggered modules (`stagger`, band `storeys`, read in C++);
  - glass balconies, baguettes, box_frame, juliet, mixed metal `panels`, mullion `caps`, `corner_window`;
  - deco spandrel `pattern` (flutes/chevron/diamond/panel);
  - mansard and orders, from the workflow (orders field `pier.order` / `ground.order`).
- Families are assigned for every style; `facade-families.mjs` merges them (no kit above ~5% of the city).
- Still to do:
  - Review r5w/r5c renders (all kits) after the latest regeneration.
  - Regenerate again for the spandrel patterns, mansards, orders and corner windows set at 04:40, then render and review again.
  - Thumbnails for the picker (`-KitThumbs`, default floors -> Data/kit-thumbs).
  - Fix the competitors.mjs quiet-sale 105% issue (the seller's rec vs resolveRec).
  - Baseline regen with a reason.
  - PR + merge.
- competitors.mjs "priced under what it would appraise at" (105%) diagnosis: the quiet sale is listed and checked in the same month (listedM == month), with the same grade (standard) and the same record (resolveRec made no difference). Ask <= 0.95 x conveyedValue at listing time, so the deed's conveyedValue falls >= 10% between the listing (mid advanceMonth, rivals pass) and month end. Find which later step of advanceMonth marks it down (occupancy/rent roll of the squeezed firm, tax, condition) and price the quiet sale after it, or on the same basis. It only showed up with the plan-13 city.

## Update, overnight 2026-10-21 (later)
Shipped on `claude/building-styles-forms` (commits pushed):
- **Facade zones:** recipe `zones` (cladding, depth `proud`, windows and feature per zone). FacadeBuilder sets out mirrored runs of 2-3 bays per wall, the same on every floor. Residential bases carry the zones down; retail podiums don't. Templates: B72-B81 (garden apartments, five-over-one, Brooklyn, offices, hotel, affordable, waterfront, student, tan mid-rise).
- **Lived-in windows:** blind variants per shaft piece (`mix` group, `variant`), picked per bay per floor (FBWKitModule::Mix).
- **Tenant storefronts:** shop variants with their own awning colour (or none) and sign band (`mix` 50).
- **Weathering by age:** FacadeBuilder sets the master's grime layers (Amt MFGD, Amount MFGB/MFDE/MFGC) from V.Year, in the TintKey top byte.
- **Roofs** (make-roof.py, CityBuilder::DressRoof):
  - louvred penthouse on lift buildings 25 m+;
  - railings on setback terraces;
  - crowns (stepped / pyramid / spire) on pre-1945 towers 60 m+.
- **Lot-line walls:** walls against another lot's building get no facade (`FacadeBuilder::Party`, probed in BuildVolumes). The mass walls are real FG brick (brown/red/buff by building).
- **Entrances:** canopies by default; `ground.stoop` for row houses (B08, B47), with the door raised to the parlour floor.
- **Generator:** see-through fire escapes (`every` 4), smooth arches, deco spandrel patterns, mansards, orders, corner windows, caps, baguettes, box frames, juliets, panels, staggered two-storey shafts.

Open questions and next ideas (visual):
- Corner buildings: chamfered or rounded corners with a corner entrance (prewar and Moderne).
- Blade signs and neon on shops.
- Party-wall painted signs (ghost signs) on old lot-line walls.
- Window AC units on prewar residential.
- Fire stairs and bulkheads on lot-line walls.
- Build desk: let the player pick a zone palette.
- City generator height variety along a street wall (src/citygen; needs tests).

## Update, 03:00 2026-10-21
- **Building forms for the player**, committed on branch `claude/forms-wip` (worktree D:/Projects/CRE-forms, commit 1b522017). Merge it into `claude/building-styles-forms` once the main test run finishes, then run the full suite again.
  - `src/citygen/forms.mjs`: PLAYER_FORMS (forms legal from 2000: step, cake, terrace, base, podium, retail base, courtyard, lightcourt, endtowers, twins, notch, telescope), `formTiers`, `formMetrics` (retained, skin), `formsFor`.
  - BuildingDesign `form` / `formRetained` / `formSkin`. The pro forma reads custom.form: gsf × retained (capped at 1), hard cost × (1 + 0.15 × (skin − 1)); EXTERIOR_CLOSURE_SHARE = 0.15 (RSMeans B20).
  - unrealHost solves tiers on the real lot (rings from toBwCity) for the render view and the preview. DesignPicker FormPicker lists only eligible forms, with the % floor area and façade each changes.
  - Measured on the metro city: small lots get no forms; medium lots get step/terrace/cake/retail base; large lots add podium, twins, telescope, base, notch.
- C++ (on the main branch): RenderLot/preview `tiers` (BWReadTiers); ApplyView and SetPreview draw one volume per tier.
- Industrial styles B85-B87, with a `ground.type: "dock"` loading-dock floor. Not yet merged into styleKits/families: run style-kits.mjs and facade-families.mjs after the tests.
- Thumbnails re-rendered at 03:00; B85-B87 need a `-KitThumbs -ShotOnly=kit-B8` run.

## Update, 04:45 2026-10-21
- Merged `claude/forms-wip` into `claude/building-styles-forms` (forms on the Build desk). city-accept passes; the full suite was restarted at 04:45 (logs D:/Projects/CRE-GAME/t-<test>.log, rest.log, baseline.log).
- competitors fixed: the quiet sale's ask is struck at month close (`Listing.askFactor`, refreshListings) on the closing appraisal. The test values the listing's disclosed roll.
- GOTCHA: `node unreal/tools/style-kits.mjs` writes `src/engine/styleKits.ts`. Never run it while tests run (stale bundle). make-styles.py / make-roof.py / C++ are safe.
- Also added since the last update:
  - corner shops (glazed corner);
  - shop glass with lit interiors;
  - contemporary crowns (glass slope, fin screen);
  - roof life (decks, solar, skylights);
  - sawtooth bays (Mesh.obox), B88-B89;
  - industrial docks B85-B87;
  - the 14-colour BW palette (make-mats.py);
  - `-KitZoom` < 0.3 = kerb-height view.
- Baseline: 27 of 45 metrics moved with plan 13 (and forms now price). Regenerate deliberately after the suite (`pnpm baseline`), with the reason (plan 13 lettable plates; forms are opt-in, so no default change).
