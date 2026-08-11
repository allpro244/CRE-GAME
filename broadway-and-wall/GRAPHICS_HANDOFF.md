# GRAPHICS & BUILDING DESIGN — Claude Code handoff

Written for a cold start in **Claude Code** (Claude Max / Opus). Owner is Brian.
He cannot playtest tonight; the brief is a **pure presentation pass** — massing,
façades, roofs/crowns, LOD, atmosphere — not economy or desk UI.

**Read this, then `BUILDINGS.md`, then the files you will touch.** Do not skim
`CLAUDE.md` for economy philosophy unless you wander into `src/engine/` (you
must not).

Re-measure before you believe counts in older docs. `BUILDINGS.md` §2 still
says “82 families”; `styles.ts` now has **152** `S_*` ids. Run `pnpm styles`.

---

## 0 · PASTE THIS INTO CLAUDE CODE FIRST

```
You are working on Broadway & Wall only (broadway-and-wall/).

Repo rules: read /workspace/AGENTS.md (or repo-root AGENTS.md). Game code is
ONLY under broadway-and-wall/. Do not restore Groundwork / Meridian / root src/.

Branch: cut from tip `claude/realestate-game-claude-code-32bppd` (or whatever
tip Brian has after merging open PRs). Name: `cursor/building-look-<suffix>`
lowercase. Do not stack on stale branches (especially not cursor/cf-yr-fix-*).

Mission: graphics + building design only. No src/engine/ money, rents, debt,
rivals RNG, or harness baseline retunes. No TopBar / RightPanel / Chart work.

Canonical map docs:
  broadway-and-wall/GRAPHICS_HANDOFF.md   ← this brief
  broadway-and-wall/BUILDINGS.md          ← families, traits, how to add a skin

Stack: MapLibre camera + parcels; Three.js custom layer paints buildings.
Highest leverage first (see GRAPHICS_HANDOFF §4). After every ThreeBuildings
touch: pnpm styles (if styles/pools changed) and
  node tools/shoot.mjs http://127.0.0.1:5173/ /tmp/bw-shoot.png --wait 20000
tsc does not catch GLSL string errors.

Start by inventorying setPlayerBuildings mid-rise style selection vs styleFor,
then crowns/roof kit, then far LOD value signatures. Ship small reviewable
commits. Prefer proportion/depth over new hue tables.
```

---

## 1 · WHERE YOU ARE

| | |
|---|---|
| **Product** | Broadway & Wall — CRE century sim |
| **Game root** | `broadway-and-wall/` |
| **Preferred tip** | `claude/realestate-game-claude-code-32bppd` (confirm with `git log -1`) |
| **Open nearby** | `#57` wishlist top-5 (economy/HUD) — **orthogonal**; do not mix into a graphics PR unless Brian asks |
| **Node / pnpm** | Node 22, pnpm 10 |

```bash
cd broadway-and-wall   # or repo root — pnpm scripts delegate
pnpm install
pnpm dev               # vite → localhost:5173
# Cloud / remote: pnpm dev --host 0.0.0.0 --port 5173
```

City is **generated at runtime** from a seed. No pipeline required for visual work.

---

## 2 · STACK (ONE PICTURE)

```
citygen (class, floors, year, footprint)
    → BuildingVolume[] + buildings3d
    → MapView.tsx (MapLibre)
         → ThreeBuildings.ts  ← almost all "building look"
         → style.ts           ← parcel fills, sky, ghost extrusions
```

- **Three.js** (`three@^0.185`) inside MapLibre `CustomLayerInterface` id `bw-three-buildings`.
- MapLibre **fill-extrusion** is fallback only if the Three layer fails.
- Façade “themes” are era × class pools in `styles.ts`, not CSS brand packs.

---

## 3 · FILE OWNERSHIP (STAY IN YOUR LANE)

| Path | Role | Touch? |
|---|---|---|
| `src/map/styles.ts` | Style registry, traits, `stylePool` / `styleFor` | **Yes** |
| `src/map/volume.ts` | `BuildingVolume` record | Yes if mass fields need extending carefully |
| `src/map/ThreeBuildings.ts` (~10k lines) | Shaders, crowns, roof kit, towers, player builds, light/haze/post | **Yes** (see split below) |
| `src/map/style.ts` | MapLibre style JSON, sky/atmosphere | Yes (graphics) |
| `src/map/cityVisuals.ts` | Weather/activity from month/econ (**read-only** on sim) | Yes for look signals |
| `src/map/MapView.tsx` | Map mount, wires volumes → Three, camera fly-in | Yes for visual wiring only |
| `src/citygen/build.mjs` | Generator `massing()` plan families | Yes for stock silhouettes; **do not** change floors/class/year economics |
| `src/citygen/citygen.mjs` / `cities.mjs` | Lots, islands | Only if silhouette work requires it; keep economic fields fixed |
| `tools/styleaudit.mjs` | `pnpm styles` | Run; edit only if audit API needs it |
| `tools/shoot.mjs` | Screenshot + GLSL/console catch | Run after merges |
| `src/engine/**` | Money, markets, debt, rivals | **NO** |
| `src/ui/TopBar.tsx`, desks, `Chart.tsx` | UI session | **NO** |

Inside `ThreeBuildings.ts`, the working split from `BUILDINGS.md`:

- **Buildings:** `FRAG` per-style branches, crown block, `fitRoofKit`, `*Geom()` props, tower kit, `setPlayerBuildings` massing/look.
- **Graphics:** `render()`, `bakeShadows()`, post, water, streets, lawns, `LIGHT` / `HAZE` / `SEASON` / `SHADOW` GLSL, plus `style.ts`.

One agent can do both tonight if Brian is solo — still keep commits separable
(`facades:` / `atmosphere:`) so review stays sane.

---

## 4 · HIGHEST-LEVERAGE WORK (DO IN THIS ORDER)

### A — Player / rival mid-rises use the real style pool *(impact high, risk low)*

`setPlayerBuildings` (~L7874) still picks mid-rise skins with a **short numeric
ladder** (`industrial → 3`, `retail → 7`, office coin-flips on 0/4/6/7…) while
generator stock goes through `styleFor` / `stylePool` (rich era × class pools).

Century play stares at **what you and rivals build**. Wire mid-rises through
`styleFor` (or an equivalent that takes class + synthetic year + floors + BBL
hash) so new stock matches generator richness. Towers (`fl >= 20`) already use
`towerMassing` + `TOWER_SKINS` — leave that path stable unless you are in §C.

**Do not** change floor counts, coverage economics, or RNG *draw counts* that
re-roll silhouettes mid-save. Hash → style id is fine; adding new `rng(s,…)`
stream draws in the engine is not (and you should not be in the engine).

### B — Crowns, parapets, roof kit *(high impact — crowns ≈ 29% of tower pixels)*

Roofs ≈ 9.5% of frame. “Everything looks the same” is usually crowns, not wall
hue. Touch `fitRoofKit`, crown block, `modernCap`, parapet traits
(`T_CAPPED_*`, `T_MODERN` / `T_STONE`).

### C — Far LOD value signatures *(high at gameplay camera)*

Shader splits at `lod` dissolve: near = edge pattern; far = **tone/value**.
New detail in the wrong half disappears. Strengthen far-half signatures so
types still read when a floor is two pixels.

### D — Tower skins / silhouette polish *(med–high risk)*

`TOWER_FAMILIES` / `TOWER_SKINS` / `towerMassing`. Coverage dial historically
did not reach the tower cleanly — there is measured commentary in
`setPlayerBuildings` about similarity transforms vs walking off the deed.
Prefer skin/crown polish before inventing new massing recipes; if you add
massing, keep tiers clipped to the lot (`plClipToLot`).

### E — Ground-floor vacancy as a *look* *(optional second pass)*

`IDEA_FEST.md` §4: dark shopfronts / block trouble visible from the air.
Read occupancy from the store / holdings **without writing** sim state.
`cityVisuals.ts` pattern: derive uniforms from existing fields.

### F — Atmosphere last

`LIGHT` / `HAZE` / `SHADOW` / bloom / shafts. Easy to wash contrast. Touch only
after A–C look right in `shoot.mjs` stills.

### Skip for now

- Rebalancing `stylePool` gates without measuring stock (`pnpm styles`).
- New hue tables as the main move (proportion + reveal depth first).
- Named landmark cosmetics (`IDEA_FEST` §6) until A–C land.
- Anything in `src/engine/`.

---

## 5 · RULES THAT WILL BITE YOU

From `BUILDINGS.md` — non-negotiable:

1. **Base albedo &lt; ~0.80** (linear contrast around ~0.18 pivot; pale ≠ glossy).
2. **Never compare style ids numerically** (`s < 8`). Ask **traits** (`has`, `T_*`).
3. **`win = vec2(0.0)`** opts out of interior mapping (sheds, blank walls).
4. **Never gate on `v.z1`** for material (wedding-cake seam). Gate on **floors**.
5. **Two paths must be fed:** generator (`build.mjs` + `styleFor`) and
   `setPlayerBuildings`. Audit only sees the generator.
6. Geometry that moves in a **vertex** shader is invisible to the shadow bake —
   mark `userData.noShadow` or you get orphan shadows.
7. No opaque geo at exactly `z = 0` (occlusion floor / water band).
8. GLSL lives in **strings** — `tsc` will not save you; `shoot.mjs` will.

---

## 6 · HOW TO ADD A FAÇADE FAMILY (CHECKLIST)

Six edits — miss any of 1–5 and you get flat grey or never appear:

1. `export const S_THING = <next id>;` in `styles.ts`
2. Trait membership (`T_MASONRY`, `T_GLASSY`, `T_TRADE`, `T_FLOORLINE`, …)
3. Palette branch in `FRAG` (`wall`, `glassA`, `glassB`, `colW`, `win`)
4. Reveal depth + roof colour ladders
5. `stylePool` entry in the right era × class
6. Optional signature math (the point — see BUILDINGS §5)

Then `pnpm styles` — **DEAD** must stay empty.

---

## 7 · VERIFY (EVERY SESSION)

```bash
cd broadway-and-wall
pnpm styles                         # DEAD / rare / DOMINANT
npx tsc -b                          # types only — not GLSL
pnpm dev                            # separate terminal
node tools/shoot.mjs http://127.0.0.1:5173/ /tmp/bw-shoot.png --wait 20000
```

`shoot.mjs` prints GLSL compile errors and page exceptions in its output line.

Optional: inspect live layer — prop meshes named `prop:<kind>`, walls carry
`aStyle` per vertex on `map.getLayer("bw-three-buildings")`.

**Do not run `pnpm gate` / century harnesses for a paint-only PR** unless you
touched citygen fields that change floors/stock. If you only touched `src/map/`,
`tsc -b` + `pnpm styles` + `shoot.mjs` is the contract.

---

## 8 · COMMIT / PR HYGIENE

- Branch: `cursor/building-look-9786` (or Brian’s cloud suffix if different).
- Commits: small, visual, named (`Wire player mid-rises through styleFor`,
  `Strengthen far-LOD masonry value signatures`, …).
- PR body: before/after **screenshots** from `shoot.mjs` (wide establish +
  street-level + tower crown). List files. Explicit “no engine changes”.
- Base: current tip (`claude/realestate-game-claude-code-32bppd` unless Brian
  says otherwise).
- Do not reopen economy wishlist items here.

---

## 9 · SUCCESS LOOKS LIKE

Brian can open a fresh City or Great City, fly the default camera, and within
ten seconds tell:

1. Pre-war fabric from postwar slabs from modern towers **by silhouette and
   depth**, not by a legend.
2. A building **he just delivered** does not look like a photocopied glass box
   next to rich generator neighbours.
3. Crowns and roof kit break the skyline; far blocks still have type, not mush.
4. `pnpm styles` is clean; `shoot.mjs` has no GLSL errors.

---

## 10 · IF YOU GET LOST

| Question | Answer |
|---|---|
| What makes a type read? | Bay width, hole shape, reveal depth — BUILDINGS §5 |
| Why is my family never drawn? | Gate unreachable for this town’s stock — measure with `pnpm styles` / generateCity |
| Why is player stock ugly? | `setPlayerBuildings` short ladder — §4A |
| Why do towers match but mid-rises don’t? | Towers use `TOWER_SKINS`; mid-rises don’t use `styleFor` yet |
| Can I change rents so vacancy shows on façades? | No — derive a look from existing occupancy; don’t retune the economy |

When in doubt: **proportion and depth over colour; player path over new dead families; crowns over another wall tint.**
