# Building forms: what a player can build, on which lots

Building form (massing) becomes a real design choice on the Build desk, as
important as the facade style. This plan merges two design catalogs (an NYC
history and zoning lens, and an economics lens) with three code maps. It
records which forms to offer, the lots each needs, and where each plugs into
the code. Lot sizes are in square feet as NYC states them; 1,000 sf ≈ 93 m².

Rules that hold for every form:
- A form refuses a lot it does not fit, and the desk offers only the forms that fit the lot.
- No tier above six storeys may be thinner than 1:8, or narrower than a lettable plate (15 m office, 12 m other).
  This is already enforced in `massing.mjs` `done()`, and it is what stopped the pencil towers.
- A form changes the economics, through measured, sourced effects only:
  - floor area retained (measured on real footprints at 60 m: quarter 0.46, cruciform 0.61, tower on a base 0.64, courtyard 0.69, light court 0.68, wedding cake 0.76, dumbbell 0.77, end towers 0.81, step 0.91, terrace 0.95, podium 1.02);
  - net/gross efficiency (core and court losses);
  - skin cost (more façade per sf);
  - rent (light, views, prestige of a top floor);
  - schedule.

## The catalog, by lot

### Small lots (to about 3,000 sf: one or two 25 ft lots)
| form | lot | floors / era | why pick it |
|---|---|---|---|
| Row house / brownstone | 16–25 ft frontage, 60 ft+ deep | 3–5, 1840–1910 | cheapest per unit, a stoop and a garden; low density |
| Taxpayer | 20 ft+ frontage, corner best | 1–2, any | holds a lot cheaply for later; shop rent only |
| Old Law dumbbell | interior 25×100 ft | 5–7 walk-up, 1879–1901 | the tenement; dense, dark, cheap to build |
| Sliver | ≤ 45 ft frontage, 60–100 ft deep | 7–24, 1970+ | height on a small lot; costly lift and core per sf |

### Medium lots (3,000–10,000 sf)
| form | lot | floors / era | why pick it |
|---|---|---|---|
| Street-wall block | any | any | the default: most floor area, plainest |
| New Law tenement (courts) | 40 ft+ frontage | 5–7, 1901–1929 | lighter rooms, more rent per unit, less area |
| Corner L | corner, both fronts 40 ft+ | any | two shop fronts, all rooms on the street |
| Loft / warehouse | 25 ft+ front, 75–200 ft deep | 3–12 | big floor plates, cheap rent per sf, conversion upside |
| Contextual base + setback | 25 ft+ front, 70 ft+ deep | 1987+ | the modern street wall; a terrace floor |
| Prewar terrace | 50×100 ft+, corner preferred | 12–20, 1920–1940 | penthouses with terraces: top-floor premium |
| Corner tower (campanile) | corner, 10,000 sf+ | base 8+, pre-1916 | a landmark: prestige rent, costly tower |

### Large lots (10,000–30,000 sf)
| form | lot | floors / era | why pick it |
|---|---|---|---|
| Light-court office (U/E) | 90 ft+ front, 70 ft+ deep | 8–20, 1885–1930 | every office has a window; loses the court's area |
| Courtyard apartment house | 20,000 sf+, both sides 100 ft+ | 6–12 | the garden court: premium rents |
| Forecourt (cour d'honneur) | 90 ft+ front | 6–14 | a grand entrance court on the street |
| Wedding cake (1916) | 80 ft+ deep | 12–30, 1916–1961 | max area under the setback rules; terraces |
| Tower on a quarter | 20,000 sf+ | 25+, 1916–1961 | unlimited height on 25% of the lot: views |
| Podium + tower | 10,000 sf+ (res), 20,000+ (office) | 20+, 1961+ | retail podium and a view tower |
| Five-over-one wrap | 15,000 sf+ | 6–7, 2000+ | cheapest new rental per unit (timber over concrete) |
| Plaza tower (1961) | 20,000 sf+, 150 ft frontage | 25+, 1961–1980 | the plaza bonus buys floors; a public plaza |
| Atrium block | 20,000 sf+, both sides 120 ft+ | 6–15, 1980+ | deep plates lit by an atrium |
| Telescoping slab | long axis ≥ 1.8 × short | 20+ | lift banks step the plate down |

### Very large lots (30,000 sf+, a blockfront)
| form | lot | floors / era | why pick it |
|---|---|---|---|
| Twin towers (Central Park West) | 30,000 sf+, 200 ft front | 25–30, 1929–1931 | the 1929 Multiple Dwelling Law towers |
| H-plan block | both sides 120 ft+ | 10–40 | the Equitable extrusion: max area; it caused the 1916 law |
| Garden apartments (perimeter) | 30,000 sf+ | 4–6 | cheap land, a big shared garden |
| Tower in the park | superblock 80,000 sf+ | 12–30, 1945–1975 | the housing project: light and air, little street life |
| Mat building | 20,000 sf+ | 1–4 | a market hall, a campus |

### Cut (they looked silly or cannot work here)
- **Twist:** pokes past the lot line on every plate measured.
- **Chamfered/pencil supertall:** needs 40,000 sf and 50+ floors. Landmark-only, if ever.
- **Shifted stack:** needs 25 m+ plates.

The anti-pencil rule now refuses all three on ordinary lots.

## Where it plugs in (from the code maps)
1. **Form geometry, shared by city and player.** `src/citygen/massing.mjs` already has 25 families; `families: [key]` forces one. Pull the eligibility gates out into a `formFits(lot)` export, beside a FORMS catalog (key, name, blurb, lot minimums, floors, eras, uses).
2. **Economics.**
   - `src/engine/types.ts` BuildingDesign/DevDraft: add `form?` (absent = extrusion, so old saves read unchanged).
   - `src/engine/proforma.ts` ~773–814: gross sf = Σ tiers (floors × plate), not lotArea × cov × floors; rentable from each tier's plate; a sourced skin-cost multiplier; schedule.
   - `structure.ts`: the floor cap reads the tower plate.
   - Regenerate BASELINE deliberately.
3. **Render.**
   - `renderView.ts` RenderLot carries `tiers` [{ring, z0, z1}], parsed in `RenderView.cpp`.
   - `CityBuilder::ApplyView` pushes one FBWVolume per tier (bCrown on the top), instead of one prism scaled by √cov.
   - FacadeBuilder already dresses tiers properly: one rhythm, no repeated base.
4. **Build desk.** A form picker beside the style picker showing only eligible forms, with the 3D preview (`SetPreview` takes the tiers).
5. **The city.** Rivals and the generator use the same catalog, so the street reads consistently.

## Gallery
`node unreal/tools/form-gallery.mjs` places every form on a real downtown lot. Render it with:

```
UnrealEditor.exe <uproject> -game -City=<out> -LookFile=<looks> -NoCrowd -Shots=<dir>
```

Latest renders: `unreal/shots/forms6`.
