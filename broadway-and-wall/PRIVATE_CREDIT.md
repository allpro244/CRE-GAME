# PRIVATE CREDIT — design contract

Single-player only. “Other lenders / borrowers” means **AI rivals** and
named desks, not multiplayer humans. Grow out of notes + Cordage + auctions;
do not invent a second banking system.

**Realism outranks preference** (`CLAUDE.md`). Lending is not a money printer.

---

## 1 · Fantasy

You can run a **hard-money / private-credit sleeve** beside the landlord book:

- Advance cash against a rival’s deed when banks won’t (hold size, sponsor
  stain, speed, Cordage too rich).
- Collect coupon and points; enforce through the **same note / July auction**
  path you already use when you buy distressed paper.
- Later: **borrow** private money yourself when your banks pass (Phase B).

Success reads like: *“Alden passed; I wrote 65% LTV bridge at 13% for nine
months; they made the balloon — or I own a half-empty walk-up.”*

---

## 2 · What already exists (reuse, don’t rebuild)

| System | Role |
|---|---|
| `notes.ts` / `Note` | Coupon, nonpay, modify×1, file, foreclosure, deed-in-lieu |
| `noteOffers` | Secondary market from **bank** books (buyer side) |
| `cityLoans` + `ledger.ts` | Street mortgage record |
| Cordage | NPC hard-money calibration target |
| `workout.ts` / `auction.ts` | Enforcement calendar |
| Rivals as obligors | Stress, balloons, aggregate `r.debt` |

**Gap:** player cannot **originate**. Phase A fills only that gap.

---

## 3 · Phases

### Phase A — Originate to rivals (this PR / next)

1. Rivals who need a cheque and cannot clear a bank desk generate a
   **private credit ask** (shortlist, expires — same choreography as note offers).
2. Player funds from **cash** (unlevered sleeve). Points at close → interest income.
3. Origination writes:
   - `r.cash += advance`, `r.debt += face`
   - `cityLoans[bbl]` with `lender = firmShort(s)`
   - a `Note` you own at par (`privateOriginated: true`) so `tickNotes` services it
4. Cap the book: outstanding private face ≤ sleeve limit (see §5).
5. UI: extend **Notes** desk with “Asks” + “your book” (no new top-level job yet).

### Phase B — You borrow private

- Rival opportunistic / PE / Cordage-like desks quote **you** when bank products
  refuse or hold-cap.
- Same term sheet shape both ways (LTV, rate, points, term, balloon).
- Funds player cash; lien on your deed; workout path if you miss.

### Phase C — Deeper stack (later)

- Buy more performing bank paper (widen note desk).
- Limited mezz behind **your** senior only after mezz stacking is honest.
- Concentration / sleeve vs AUM rails tuned from harnesses, not vibes.

### Explicitly out of scope

- Multiplayer bilateral loans
- Deposit-taking / full bank charter / regulators
- Infinite warehouse leverage on your own notes

---

## 4 · Product terms (Phase A)

Hard-money shaped, Cordage-adjacent:

| Term | Band | Notes |
|---|---|---|
| LTV | 50–70% of as-is | Never above Cordage’s reckless end without teeth |
| Coupon | index + 600–900 bp | Expensive flexible money |
| Points | 1–3% of face | Cash to you at close |
| Term | 6–18 months | Bridge, not permanent |
| Amort | IO | Balloon at maturity |
| Recourse | Effective via firm stress | Rival book feels the miss |

Why a rival asks (any one is enough):

- Bank hold / LTC too small for the job or refi
- Sponsor standing locked out of cheap desks
- Balloon inside 6 months and Cordage quote worse than your sleeve
- Speed (close this month)

---

## 5 · Sleeve & anti–money-printer rules

1. **Fund from cash only** in Phase A (no LOC to warehouse loans).
2. **Book cap:** sum of private-originated face ≤ `min(0.35 × NW, cash + 0)` at
   quote time, and always leave `PRIVATE_CASH_RESERVE` ($500k or 3mo G&A).
3. **One private lien per deed.** No stacking on a deed that already has
   `cityLoans` or a player `Note`.
4. **You cannot lend to yourself.**
5. **Losses are real** — foreclosure → worn REO via existing `takeDeed`.
6. **Illiquid** — no mark-to-market NW boost beyond cash coupons and basis;
   the note carries at basis like today’s purchased notes.
7. Every advance / coupon / point / payoff / loss hits `logBooks` (conserve).

---

## 6 · Data model

```ts
// types.ts
interface PrivateCreditAsk {
  id: string;
  rivalId: string;
  rivalName: string;
  bbl: string;
  address: string;
  face: number;        // proposed advance
  ratePct: number;
  points: number;      // fraction of face
  termM: number;
  ltv: number;         // face / as-is
  asIs: number;
  why: string;
  offeredM: number;
  expiresM: number;    // short window — 2–3 months
}

// Note gains:
privateOriginated?: boolean;  // maturity/payoff must clear r.debt + cityLoans
```

GameState: `privateAsks?: PrivateCreditAsk[]`, `nextPrivateAskId?: number`.

---

## 7 · Engine surface (Phase A)

| Function | File | Job |
|---|---|---|
| `privateSleeveCapacity` | `privateCredit.ts` | How much face you can still write |
| `tickPrivateCredit` | `privateCredit.ts` | Spawn/expire asks |
| `fundPrivateAsk` | `privateCredit.ts` | Close → Note + cityLoans + rival cash |
| `declinePrivateAsk` | `privateCredit.ts` | Pass (rival may go to Cordage / fail balloon) |
| `serviceNotes` tweak | `notes.ts` | On payoff of `privateOriginated`, cut `r.debt`, drop `cityLoans` |
| Store actions | `store.ts` | `fundPrivateAsk` / `declinePrivateAsk` |
| UI | `NotesPage.tsx` | Asks list + book summary |

Month order: after lenders/rivals stress is known, before or beside `tickNotes`.

---

## 8 · UI (Phase A)

**Notes desk** grows a second rail:

1. **Bank paper** (existing offers)
2. **Private asks** (rivals wanting your money)
3. **Your private book** (filter notes where `privateOriginated`)

Copy is newspaper-reportorial, same voice as notes. No new top-bar job until
Phase B volume justifies it.

---

## 9 · Harnesses

| Test | Asserts |
|---|---|
| `test/private-credit.mjs` | Fund ask → cash/debt/note/cityLoans; coupon lands; sleeve rejects over-cap; second lien refused; maturity clears rival debt |
| `pnpm conserve` | Advances and coupons balance |
| Later | Century sleeve share; loss rate vs Cordage |

---

## 10 · Pitfalls checklist (do not regress)

- [x] Money printer (warehouse with LOC, free NW marks) — cash-only sleeve + NW rail
- [x] Double first liens — `deedAlreadyLiens` before fund
- [ ] Conserve leak on advance/payoff — covered by `logBooks`; run `pnpm conserve` in CI/harness
- [x] Rival AI that only exists to feed you deals — episodic spawn (~22%), need + sleeve gate
- [x] Coupon farming dominates development forever (sleeve cap)
- [x] UI chore (asks expire; attention + Notes badge; servicing silent like notes)
- [x] Sale of originated paper leaves street clear — lender transfers, debt stays

---

## 11 · Implementation order (this branch)

1. This document.
2. Types + `privateCredit.ts` + note payoff hook.
3. `tickPrivateCredit` wired from `sim.ts`.
4. Store + Notes UI asks rail.
5. `test/private-credit.mjs` green.
6. Phase B only after A is playable for a decade in harness.

When in doubt: **expensive, finite, enforceable — Cordage with your name on it.**
