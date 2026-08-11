# Principal playtest sheet — machine findings + what only you can see

**Branch:** `cursor/the-principal-9786` · **PR #62**  
**Date:** pre-flight before first human session  
**Scope:** Person / careers / mortality / estate / fund / genealogy

---

## Machine verdict (already run)

| Check | Result |
|---|---|
| `pnpm engine` then `pnpm gate` | green |
| `pnpm check` | green (baseline *reports* movement — see below) |
| `test/entry.mjs` | `people`, `estate`, `fund` present |
| Succession sets `gameOver` | **no** — 6/6 seeds fire heir, world keeps advancing |
| Conserve identity | green; `lpCalled` / `lpDistributed` **move** (planted). `borrowed` still dead (pre-existing). Estate tax not separately exercised (uses `taxes`, which moves via property tax). Promote is a transfer (no bucket — correct). Life insurance **not implemented**. |
| Purity on render | PersonCard / street reads are pure |
| One quantity / two answers | Top bar Cash = GP; Vehicle = fund (labeled). Net worth = `netWorth()` firm equity — **was unlabeled**; estate-net-of-tax is only on PersonCard as `estateDue`, not a second NW function |

### Baseline

`BASELINE.json` still cites commit `ffb883a`. This branch did **not** regenerate it. `pnpm baseline:check` reports **22/35 metrics moved >0.5%**. Phase 1 claimed bit-identity; Phases 4–7 intentionally change the world (rival deaths, estate tape, firm entry). **Nobody has written down which baseline moves are the Principal’s.** Treat the report as “world moved; not yet explained line-by-line.”

### peopleRng

Death is drawn once at creation. Quiet months that step the stream are almost entirely the **fixed** hire-pool refresh (9 candidates / 6 months). Death / heir / new-firm months step more — event-driven, not “once per living rival.” No monthly lottery over the living population.

### Save migration

`migrateSaveState` → v33 + `ensurePeople`. **No real pre-v33 save exists in the repo** (IndexedDB only at runtime). Synthetic v31→33 path is covered by `continue-path.mjs`. Could not load a human save here.

---

## Reachability (medians you need)

Horizon for a human session ≈ **30–40 in-game years**.

| Mechanic | Median first fire | Reachable tomorrow? |
|---|---|---|
| First **rival principal** death | **~month 22 (~1.8y)** | **Yes** — early |
| Estate disposition from that death | same month (listings + news) | **Yes** |
| Private-holder “ESTATE” on Marketplace | only true estates | **Fixed in pre-flight** — was tagging all holder exits as `estate`; now `voluntary` unless holder kind is estate |
| Player death @ $20M / age 52 | death age **70–90** → **~18–38y** left | Late in a long sitting; Year-click |
| Player death @ $2.5M / age 35 | death age **70–90** → **~35–55y** left | **No** in a short session |
| Fund raise eligible | needs **2 clean exits** + institutional standing + non-crunch phase | **Only if you sell** — bot never got there in 50y |
| Promote crystallises | after raise + distribute with pref current | After you raise |
| Staff departure → founder bid | needs hire, tenure ≥24m, ability ≥72, poach roll | **Unlikely** in first session unless you staff up early and wait |
| Career “Knows …” on you | **month 0** (seeded prior career) | **Yes** immediately |

---

## Concrete setups (do these)

1. **Succession inside a long sitting**  
   Start **$20M / age 52**. Death age is drawn in **70–90**, so you have roughly **18–38 years**. Spam **Year** until the death news. Confirm: heir seated, phone book wiped, bench stays, Advance still works, estate bill on Staff → you.

2. **Rival estate on the tape early**  
   Same or any seed. By **year 2** you should see a *named* death in News and distressed listings. On Marketplace, prefer rows that follow a death headline — not every “ESTATE” badge (that badge was polluted; fix lands with this pre-flight).

3. **Fund path in one session**  
   Buy two small buildings, hold ≥ a year if you want a real gain, **sell both cleanly** (not forced). When Capital → Debt → The fund offers a raise, take it. Call capital, buy one with **Buying from the vehicle**, distribute once pref is paid to see promote hit GP Cash while Vehicle falls.

4. **Careers**  
   Open **Staff** day one — your card shows **Knows …**. Hire into a class you don’t know; watch whether the desk feels heavier (capacity / slip), not a rent multiplier.

---

## What “working” looks like vs failure

| Look at | Working | Failure |
|---|---|---|
| News + Street principal age | Named death; heir name; firm continues | World freezes; `gameOver`; principal age stuck |
| Marketplace after a death | Distressed asks; seller story matches news | Random “ESTATE” with no death (pre-fix noise) |
| Staff → you after your death | New name/age; attrs yours; estate due; staff still there | Soft lock; staff wiped; still the dead name |
| Top bar Cash vs Vehicle | Cash = firm; Vehicle only with live fund | One number that mixes both |
| Fund desk | Raise gated; promote only after pref | Free money every distribute; raise with no exits |
| Spinout (if you get one) | News names the person; Street shows · spinout | Person vanishes with no trace |

---

## Questions only a human can answer

1. Is watching a rival principal age — and then die — **fun**, or just a ledger event?
2. Does continue-as-heir feel like a second life worth playing, or a tax screen?
3. Is the fund’s second cash account clear in the UI, or do you keep spending “your” money by mistake?
4. Does “Knows office / industrial” change how you hire and where you buy, or is it flavor text?
5. When someone leaves to raise, do you care — or is it just an empty desk?

---

## What this machine could not verify

- Feel / pacing / whether succession is a climax or an interruption  
- Whether fund promote “bites” emotionally once you’re attached to a building  
- A real pre-v33 IndexedDB save round-trip on your machine  
- Organic promote from a held fund asset over a full invest period (probe forced distribute)  
- Spinout under normal play rates in &lt;40y without intentional staffing  
- Line-by-line baseline attribution for every moved metric  

Be harsh on the questions above. The harnesses already said the money still adds up.
