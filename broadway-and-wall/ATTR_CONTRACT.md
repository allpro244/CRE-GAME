# Attribute contract — temperament, competence, firm

**Status:** Phases 1–7 landed on `cursor/attr-system-9786` (leveling UI is readout-only — no XP bars).  
**Rule source:** `HANDOFF_PRINCIPAL.md` §5 guardrail + `CLAUDE.md` (no fake multipliers).

Re-measure before trusting any coefficient cited here.

---

## 0 · One sentence

Every person (you, staff, rival) has the same four **temperament** attrs;  
**competence** is career months by class/district;  
**firm capital** is institutional standing (hire name, lenders, exits, bench, vehicle, book).  
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

## 2b · Desk redesign (October 2026) — what a hire replaces

Supersedes the PM/leasing rows of §3 below. Nobody on payroll does not mean
nobody doing the work — it means the work is **bought**:

| Desk | Bought from (no hire) | Quality when bought | A hire brings in-house… |
|------|-----------------------|---------------------|--------------------------|
| PM | third-party manager, the 4% `MGMT_FEE` every building already pays | `OUTSIDE_DESK_SKILL` = 50 → multipliers 1.0 | the fee on the covered share (paid to your management company, less `IN_HOUSE_MGMT_COST` 2.5% of EGI back office; net in G&A) |
| Leasing | outside brokers on 4%/2% commission | 50 → tours/rent 1.0 | the landlord half of the commission on covered space (`LANDLORD_SIDE_SHARE`) |
| Construction | **you** — no owner's-rep fee exists in the cost stack | your Rigor + Bandwidth | capacity; float skill is the capacity-weighted mean of you + CMs |

- Coverage is capacity / load per pinned person or float, capped at 1. The
  rest stays outside at the outside price. **PM and leasing never slip.**
- Construction keeps slip: past the cover of whoever is watching, `cmRiskMult` rises.
- Appraisals and the property statement still carry a market 4% fee.
- Your temperament no longer moves PM opex/renewals or leasing tours/rent —
  the outside firm was doing that work. It still drives construction cover,
  the leasing pen, and learning rates.
- Harnesses: `pnpm staff` (A/B/F rewritten), `node test/staff-desks.mjs`, `pnpm attrs`.

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
| **5** | Firm capital v0 (`firmCapital.ts` — hire / lender / exits / bench / vehicle / book) | **This PR** |
| **6** | Leveling readouts — Staff firm-capital panel + career years on PersonCard | **This PR** |
| **7** | Rival temperament on tape — `rivalTemperamentWeight` in `rivalBuys` | **This PR** |

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
