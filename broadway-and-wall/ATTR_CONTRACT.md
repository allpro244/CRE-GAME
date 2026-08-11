# Attribute contract — temperament, competence, firm

**Status:** Phase 1–3 landed on `cursor/attr-system-9786`. Phases 4–6 are next.  
**Rule source:** `HANDOFF_PRINCIPAL.md` §5 guardrail + `CLAUDE.md` (no fake multipliers).

Re-measure before trusting any coefficient cited here.

---

## 0 · One sentence

Every person (you, staff, rival) has the same four **temperament** attrs;  
**competence** is career months by class/district;  
**firm capital** (later) is what survives when a person dies.  
No skill may make the market kinder — only capacity, access, information, and time.

---

## 1 · Storage vs display

| Storage key (save-stable) | Display name | Axis |
|---------------------------|--------------|------|
| `judgment` | Deal sense | Information → decisions |
| `urgency` | Bandwidth | Capacity + Time |
| `diligence` | Rigor | Information + Time |
| `relationships` | Access | Access |

Keys stay forever so old saves / harnesses do not re-roll. UI and tooltips use display names.

**Retired as permanent stats:** `costControl`, `tenantCare`, `marketKnowledge`, `negotiation`, `scheduling`.  
Legacy rows may still carry them; readers **fall back** through `temperamentSkill()` so old saves keep working. New hires draw only the four.

---

## 2 · Exclusive effects (Phase 1–3)

### Temperament

| Attr | Capacity | Quality / decisions | Access / info |
|------|----------|---------------------|---------------|
| **Deal sense** (`judgment`) | — | LOI pen (sign vs refer); PM/leasing skill blend; desk skill when you cover float | — |
| **Bandwidth** (`urgency`) | Owner + staff SF capacity | Burnout target under slip | — |
| **Rigor** (`diligence`) | Staff PM/CM capacity (with Bandwidth) | Controllable opex / site risk / band-narrow rate | How fast you learn staff truth |
| **Access** (`relationships`) | Leasing capacity (with Bandwidth) | Tenant care / leasing skill blend | Broker cold skip (existing); poach resistance via mean ability |

### Competence (career) — unchanged contract

`careerLoadMult` only: unfamiliar class/district → more desk load. Never multiplies rent.

### Forbidden

- Rent × attr, NOI × attr, cap rate × attr  
- Separate player-only stats  
- Free hands-on button (inferred headcount only)

---

## 3 · Player = org chart (the hole this closes)

Before: float desk with no hires used **skill = 42**; owner capacity ignored your attrs.  
After:

- `ownerCapacitySf` scales with your **Bandwidth** (and headcount shape).  
- Float skill with no floaters uses **your** temperament via the same `skillKeys` mapping as staff.  
- Empty leasing pen uses **your** Deal sense / Access, not mid-50 defaults that ignore you.  
- Empty PM tenant-care uses **your** Rigor + Access.

---

## 4 · Phased plan

| Phase | Deliverable | Status |
|-------|-------------|--------|
| **1** | This contract + display labels + temperament helpers | **This PR** |
| **2** | Wire player into capacity / float skill / desk pens | **This PR** |
| **3** | New hires: four attrs only; role attrs → fallback maps; skillKeys on temperament | **This PR** |
| **4** | Harness `pnpm attrs` — player float ≠ 42; Bandwidth moves capacity; legacy role attrs still read | **This PR** |
| **5** | Firm capital v0 (hire reputation + lender standing as maturity readout) | Later |
| **6** | Leveling UI (career years, firm milestones, temperament polish caps) | Later — after playtest |
| **7** | Rival temperament on tape (Access/Bandwidth pace) | Later |

---

## 5 · Leveling (design freeze — do not implement XP bars yet)

| Track | Grows by | Unlocks |
|-------|----------|---------|
| Person career | Operating months | Lower load / better quality on that beat |
| Temperament polish | Slow ± under load or spare capacity | Capped; never a build |
| Firm capital | Clean exits, standing, process | Access channels, raise gates |

No ding/Level-12. No start-menu skill points.

---

## 6 · Measurement

```bash
pnpm engine
pnpm attrs          # temperament contract
pnpm staff          # payroll / capacity harness
pnpm principal      # Person seat still green
pnpm check          # conserve + baseline report
```

If baseline moves, attribute in `BASELINE_ATTRIBUTION.md` — player desk skill leaving 42 is intentional.
