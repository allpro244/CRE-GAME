// FIRMS AS COMPANIES — the ways a firm changes hands that are not a raid or
// a failure. Once a year, each on a hashed clock (no RNG stream):
//
//   A MERGER. Two mid-size firms that buy the same things in the same places
//   combine: the bigger takes the smaller's book, paper and partners, and the
//   two sheets blend 70/30. Mid-market shops do this when scale is the only
//   way to win the next deal — and it is one more name off the tape.
//
//   A SALE TO AN INSTITUTION. A firm that has at least doubled its equity
//   over a decade and runs on a sell-it-eventually clock gets bought, as a
//   platform, by a pension fund or an insurer. It keeps its book and its
//   people and acquires an institution's temperament: less leverage, a
//   longer hold, a slower committee.
//
//   SUCCESSION. A family firm passes to the next generation every twenty-
//   five years or so, and what the heirs do is in the sheet: a patient family
//   carries on (a little bolder — the young always are); a family with a
//   grudge in it splits the book between two branches that then bid against
//   each other; a family that never loved the business sells.
import type { ParcelTable } from "@/data/types";
import type { GameState, Rival } from "./types";
import { START_YEAR } from "./types";
import { hash01 } from "./competitorTraits";
import { logFirm, milestone } from "./firmLog";
import { livingRivals, markRival, paramsOf, transferDeed } from "./rivals";
import { assumeBook, loanBookTouched, rowOn, syncDebt } from "./rivalDebt";

const year = (s: GameState) => START_YEAR + Math.floor(s.month / 12);

/** Everything the absorbed firm had in motion goes with the company. */
function absorb(s: GameState, from: Rival, into: Rival) {
  milestone(s, into, `Absorbed ${from.name} and its ${from.bbls.length} building${from.bbls.length === 1 ? "" : "s"}`);
  milestone(s, from, `Absorbed into ${into.name}`);
  for (const li of s.listings) if (li.sellerId === from.id) li.sellerId = into.id;
  for (const rn of s.rivalNotes ?? []) if (rn.firmId === from.id) { rn.firmId = into.id; rn.firm = into.name; }
  if (s.portfolios) s.portfolios = s.portfolios.filter((p) => !p.bbls.some((b) => from.bbls.includes(b)));
  assumeBook(s, from, into);
  for (const j of s.cityJobs ?? []) if (j.firmId === from.id && !j.orphaned) j.firmId = into.id;
  for (const bbl of [...from.bbls]) transferDeed(s, bbl, into, 0);
  into.cash += from.cash;
  if (from.uncalled !== undefined) into.uncalled = (into.uncalled ?? 0) + from.uncalled;
  into.basis = (into.basis ?? 0) + (from.basis ?? 0);
  syncDebt(s, into);
  from.bbls = []; from.debt = 0; from.cash = 0; from.uncalled = 0; from.aum = 0; from.stressMs = 0;
  from.heldSince = {};
  delete from.extendedTo; delete from.deliveredM;
  from.failedM = s.month;
  from.endReason = "absorbed";
  from.takenOverBy = into.id;
  from.epilogueM = -1;
}

/** Shared appetite between two sheets: classes and where. 0..1. */
function overlap(a: Rival, b: Rival): number {
  const ks = ["office", "residential", "retail", "industrial", "land", "prime", "edge"] as const;
  let d = 0;
  for (const k of ks) d += Math.abs(a.sheet![k] - b.sheet![k]);
  return 1 - d / (ks.length * 100);
}

function mergers(s: GameState, parcels: ParcelTable) {
  // A firm under an ONLY rule does not merge: the other book would break it.
  const live = livingRivals(s).filter((r) => r.sheet && !r.stressMs && r.bbls.length >= 2 && !r.rules?.includes("neverSells")
    && !(r.rules ?? []).some((x) => x.startsWith("only")));
  if (live.length < 6) return;
  const sizes = live.map((r) => r.aum ?? 0).sort((a, b) => a - b);
  const lo = sizes[Math.floor(sizes.length * 0.2)], hi = sizes[Math.floor(sizes.length * 0.75)];
  const mid = live.filter((r) => (r.aum ?? 0) >= lo && (r.aum ?? 0) <= hi);
  let best: { a: Rival; b: Rival; o: number } | null = null;
  for (let i = 0; i < mid.length; i++) for (let j = i + 1; j < mid.length; j++) {
    const o = overlap(mid[i], mid[j]);
    if (o > 0.82 && (!best || o > best.o)) best = { a: mid[i], b: mid[j], o };
  }
  if (!best || hash01(`${s.seed}:merge:${best.a.id}:${best.b.id}:${s.month}`) > 0.35) return;
  const [into, from] = (best.a.aum ?? 0) >= (best.b.aum ?? 0) ? [best.a, best.b] : [best.b, best.a];
  // The combined book has to sit inside the survivor's own covenant.
  const aum = (into.aum ?? 0) + (from.aum ?? 0);
  if (aum <= 0 || (into.debt + from.debt) / aum > paramsOf(into).maxLtv) return;
  const n = from.bbls.length;
  for (const k of Object.keys(into.sheet!) as (keyof NonNullable<Rival["sheet"]>)[]) {
    into.sheet![k] = Math.round(into.sheet![k] * 0.7 + from.sheet![k] * 0.3);
  }
  absorb(s, from, into);
  into.aum = Math.round(markRival(s, parcels, into).aum);
  ((into.lessons ??= []).push({ y: year(s), text: `Merged with ${from.name} in ${year(s)}` }), logFirm(s, into, "event", `Merged with ${from.name} in ${year(s)}`));
  s.news.unshift({
    q: s.month, kind: "event",
    text: `${into.name} and ${from.name} have merged. They were buying the same buildings in the same streets, and one of them `
      + `would have lost the next deal to the other; now ${into.name} owns ${into.bbls.length} buildings, ${n} of them ${from.name}'s, `
      + `and there is one fewer bidder on the tape.`,
  });
}

const INSTITUTIONS = [
  "Commonwealth Teachers' Pension", "Hanover Mutual", "Northern Assurance", "the State Employees' Fund",
  "Laurentian Life", "Merchant Navy Pension Trust",
];

function salesToInstitutions(s: GameState) {
  for (const r of livingRivals(s)) {
    if (!r.sheet || r.stressMs || r.soldToM !== undefined || r.bbls.length < 5) continue;
    if (r.sheet.hold > 60 || s.month - (r.bornM ?? 0) < 180) continue;
    const h = r.eqHist ?? [];
    if (h.length < 11) continue;
    const e0 = h[h.length - 11][1], e1 = h[h.length - 1][1];
    if (!(e0 > 0) || e1 / e0 < 2) continue;
    if (hash01(`${s.seed}:inst:${r.id}:${s.month}`) > 0.08) continue;
    const buyer = INSTITUTIONS[Math.floor(hash01(`${s.seed}:instname:${r.id}`) * INSTITUTIONS.length)];
    const was = r.name;
    r.soldToM = s.month;
    // AN INSTITUTION'S TEMPERAMENT: lower leverage, a longer hold, a slower,
    // more careful committee and no appetite for trouble.
    const sh = r.sheet;
    sh.leverage = Math.min(sh.leverage, 35);
    sh.hold = Math.max(sh.hold, 85);
    sh.discipline = Math.max(sh.discipline, 75);
    sh.distress = Math.min(sh.distress, 35);
    sh.cashOut = Math.min(sh.cashOut, 25);
    sh.capacity = Math.min(100, sh.capacity + 10);
    r.rules = (r.rules ?? []).filter((x) => x !== "alwaysCourthouse");
    r.thesis = undefined;   // the new owners set the plan at the next review
    ((r.lessons ??= []).push({ y: year(s), text: `Sold to ${buyer} in ${year(s)} — an institution's money now` }), logFirm(s, r, "event", `Sold to ${buyer} in ${year(s)} — an institution's money now`));
    s.news.unshift({
      q: s.month, kind: "event",
      text: `${was} has sold itself to ${buyer}. Ten years of doubling its money made it the platform an institution wanted; `
        + `the founders are out, the name stays, and the leverage, the hurry and the appetite for anybody else's trouble go with them.`,
    });
  }
}

function successions(s: GameState, parcels: ParcelTable) {
  for (const r of livingRivals(s)) {
    if (!r.sheet || r.stressMs || r.bbls.length < 2) continue;
    const family = r.style === "family" || r.profile === "dynasty" || r.profile === "preservationist";
    if (!family) continue;
    const since = r.genM ?? r.bornM ?? 0;
    if (s.month - since < 300) continue;
    if (hash01(`${s.seed}:heir:${r.id}:${s.month}`) > 0.25) continue;
    r.genM = s.month;
    const sh = r.sheet;
    if (sh.grudge >= 70 && r.bbls.length >= 4) {
      // THE SPLIT. Half the book, its loans and a share of the cash go to the
      // other branch, which carries the same sheet and the old argument.
      const id = `r${s.rivals.length}`;
      const base = r.name.replace(/\s+(Co\.|Partners|Holdings|Capital|Group|Realty|Trust|Investments|Estate Co\.|Property Co\.|Development Co\.|Brothers|& Sons)$/i, "");
      const name = `${base} Brothers`;
      const half = r.bbls.filter((_, i) => i % 2 === 1);
      const cash = Math.round(Math.max(0, r.cash) * 0.45);
      const twin: Rival = {
        id, name, style: r.style, cash, debt: 0, bbls: [], targetLtv: r.targetLtv, bornM: s.month, basis: 0,
        sheet: { ...sh, leverage: Math.min(100, sh.leverage + 8), discipline: Math.max(1, sh.discipline - 8) },
        rules: [...(r.rules ?? [])], quirks: [...new Set([...(r.quirks ?? []), "feuding" as const])], profile: r.profile,
        home: r.home, feud: r.id, spawnedFrom: { firmId: r.id, firmName: r.name }, genM: s.month,
      };
      s.rivals.push(twin);
      r.cash -= cash;
      r.feud = id;
      for (const b of half) {
        const row = rowOn(s, r, b);
        if (row) { row.obligorId = id; loanBookTouched(); }    // the mortgage goes with its building
        transferDeed(s, b, twin, 0);
      }
      twin.basis = Math.round((r.basis ?? 0) * half.length / Math.max(1, half.length + r.bbls.length));
      r.basis = Math.max(0, (r.basis ?? 0) - twin.basis);
      syncDebt(s, r); syncDebt(s, twin);
      twin.aum = Math.round(markRival(s, parcels, twin).aum);
      ((r.lessons ??= []).push({ y: year(s), text: `Split between the heirs in ${year(s)} — the other half is ${name}` }), logFirm(s, r, "event", `Split between the heirs in ${year(s)} — the other half is ${name}`));
      s.news.unshift({
        q: s.month, kind: "event",
        text: `The ${base} family could not agree on what to do with the business, so they have halved it: ${half.length} buildings `
          + `go to ${name}. The two branches will be bidding against each other within the year.`,
      });
    } else if (sh.hold >= 75) {
      // CARRYING ON, a little bolder: the next generation always is.
      sh.leverage = Math.min(100, sh.leverage + 6);
      sh.capacity = Math.min(100, sh.capacity + 6);
      sh.hold = Math.max(1, sh.hold - 5);
      ((r.lessons ??= []).push({ y: year(s), text: `A new generation took over in ${year(s)}` }), logFirm(s, r, "event", `A new generation took over in ${year(s)}`));
      s.news.unshift({
        q: s.month, kind: "info",
        text: `${r.name} has passed to the next generation. They are keeping the buildings, and they are going to want more of them.`,
      });
    } else {
      // SELLING UP: the heirs never loved it. The book goes out over a few years.
      r.thesis = { kind: "harvest", fromM: s.month, untilM: s.month + 48, why: "heirs selling" };
      sh.hold = Math.min(sh.hold, 20);
      ((r.lessons ??= []).push({ y: year(s), text: `The heirs decided to sell, in ${year(s)}` }), logFirm(s, r, "event", `The heirs decided to sell, in ${year(s)}`));
      s.news.unshift({
        q: s.month, kind: "deal",
        text: `The heirs at ${r.name} have decided they do not want to be landlords. ${r.bbls.length} buildings will come to market `
          + `over the next few years — family buildings, held a generation, on whatever terms the estate can get.`,
      });
    }
  }
}

/** Once a year, in September: mergers, sales to institutions, family successions. */
export function tickCorporate(s: GameState, parcels: ParcelTable) {
  if (s.month % 12 !== 8 || !s.rivals?.length) return;
  mergers(s, parcels);
  salesToInstitutions(s);
  successions(s, parcels);
}
