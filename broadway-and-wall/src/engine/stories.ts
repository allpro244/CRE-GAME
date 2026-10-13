// THE PAPER, AS OPPOSED TO THE WIRE.
//
// `s.news` is a wire: a hundred and twenty rolling lines, written at the
// moment something happened, by whichever system happened to be running. It
// is honest and it is nearly unreadable, because the interesting thing about a
// city is almost never one event. It is the SHAPE of several — a lot that
// sold for $383K, grew seven floors, was taken back by the lender before it
// topped out, went to a distress buyer for $6.6M and four months later to a
// doctors' partnership for $11.5M. Every one of those facts was on the wire
// once, years apart, and no player could be expected to put them together.
//
// This module puts them together. It reads the permanent structured record —
// the deed histories, the comps, the street's firms, the swans, the stations,
// the player's exits — and writes the stories that are only visible across
// time. It is a reader and nothing else: it draws no random numbers (the
// stream positions are part of the save), it writes nothing to the state, and
// every figure it prints is a figure the engine already recorded. A story is
// selected by how surprising its facts are, never invented to fill a page.
import type { ParcelRecord } from "@/data/types";
import type { BuiltClass, GameState, PropertyEvent } from "./types";
import { monthLabel, START_YEAR } from "./types";
import { money } from "./money";
import { firmShort } from "./firm";
import { districtLabelOf } from "./mix";
import { NATURAL_VAC } from "./market";

export type StorySection = "yours" | "market" | "deeds" | "street" | "skyline" | "places";

export interface StoryBeat {
  m: number;
  text: string;
  tone?: "up" | "down";
}

export interface Story {
  /** Stable across months, so a story can be recognised as the same story. */
  id: string;
  section: StorySection;
  /** The small caps over the headline — what KIND of story this is. */
  kicker: string;
  head: string;
  body: string;
  /** The month of the latest fact in it. */
  m: number;
  /** How surprising it is, before recency. Comparable across sections. */
  score: number;
  bbl?: string;
  mine?: boolean;
  /** A deed's whole arc, oldest first, for the stories that are an arc. */
  beats?: StoryBeat[];
}

export interface StoryStat {
  label: string;
  value: string;
  note: string;
  /** Set when the note is a record or a turn worth flagging. */
  flag?: boolean;
}

export interface Paper {
  stories: Story[];
  numbers: StoryStat[];
  /** "Ten years ago this month" — one line from the city's own past. */
  almanac: { m: number; text: string; bbl?: string }[];
}

type Parcels = Record<string, ParcelRecord>;

const yr = (m: number) => START_YEAR + Math.floor(m / 12);

/** "a doctors' partnership" → "A doctors' partnership" at the head of a sentence. */
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** A party in the middle of a sentence: "the city", not "The city". */
const mid = (p: string | undefined, dflt: string) => (!p ? dflt : p === "The city" ? "the city" : p);

/**
 * A NAMED party — a firm, a bank, the player — as against the street's
 * anonymous buyers ("a pension fund out of Hartford"). Only a named party can
 * be followed from one deed to the next.
 */
const named = (p?: string) => !!p && /^[A-Z]/.test(p) && !/^(The courthouse|A receiver)/.test(p);

function span(months: number): string {
  if (months < 1) return "the same month";
  if (months < 24) return `${months} month${months === 1 ? "" : "s"}`;
  const y = Math.round(months / 12);
  return `${y} years`;
}

const WORDS = ["", "", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const count = (n: number) => (n < WORDS.length && n >= 2 ? WORDS[n] : String(n));

/** "a" or "an" before a word or a number said aloud ("an 8-storey", "an 11.2% cap"). */
const an = (w: string) => (/^(8|11|18|80|[aeio])/i.test(w) ? `an ${w}` : `a ${w}`);

function pct(a: number, b: number): string {
  return `${Math.round(Math.abs(a / b - 1) * 100)}%`;
}

/**
 * Money a story turns on is log-scaled into points, so a $40M flip outranks a
 * $400K one without drowning everything else on the page.
 */
const dollarPts = (d: number) => Math.max(0, Math.log10(Math.max(1, Math.abs(d))) - 4.5);

function addressOf(parcels: Parcels, bbl: string): string {
  return parcels[bbl]?.address ?? `lot ${bbl}`;
}

/** Floors and use as one phrase: "a 7-storey apartment building". */
function buildingPhrase(e: PropertyEvent): string {
  const use = e.use === "multifamily" ? "apartment building"
    : e.use === "office" ? "office building"
    : e.use === "retail" ? "retail building"
    : e.use === "industrial" ? "industrial building"
    : "building";
  return e.floors ? an(`${e.floors}-storey ${use}`) : `a new ${use}`;
}

function beatOf(e: PropertyEvent): StoryBeat {
  switch (e.kind) {
    case "trade":
      return {
        m: e.m,
        text: `${cap(e.party ?? "a buyer")} bought it${e.amount ? ` for ${money(e.amount)}` : ""}${e.outcome === "distress sale" ? " — distressed" : ""}`,
      };
    case "build-start":
      return { m: e.m, text: `${cap(e.party ?? "Someone")} broke ground on ${buildingPhrase(e)}` };
    case "delivered":
      return { m: e.m, text: `${cap(buildingPhrase(e))} opened`, tone: "up" };
    case "demolished":
      return { m: e.m, text: "Knocked down", tone: "down" };
    case "default":
      return { m: e.m, text: (e.outcome ? cap(e.outcome) : "Lender took it back"), tone: "down" };
    case "major-lease":
      return { m: e.m, text: `${cap(e.party ?? "A tenant")} signed for ${e.sf ? `${Math.round(e.sf).toLocaleString()} sf` : "a big block of space"}` };
    case "planning":
      return { m: e.m, text: e.outcome ? cap(e.outcome) : "The zoning changed" };
    case "converted":
      return { m: e.m, text: e.outcome ? cap(e.outcome) : "Conversion to a new use begun", tone: "up" };
  }
}

/** Every deed's history, oldest first, folding in comps the log never saw. */
function histories(g: GameState): Map<string, PropertyEvent[]> {
  const out = new Map<string, PropertyEvent[]>();
  for (const [bbl, log] of Object.entries(g.propertyLog ?? {})) out.set(bbl, [...log]);
  for (const c of g.comps ?? []) {
    const log = out.get(c.bbl) ?? [];
    if (log.some((e) => e.kind === "trade" && e.m === c.m && e.amount === c.price)) continue;
    log.push({
      m: c.m, kind: "trade", party: c.buyer, otherParty: c.seller, amount: c.price,
      outcome: c.distress ? "distress sale" : c.offMarket ? "off-market" : "marketed",
    });
    out.set(c.bbl, log);
  }
  for (const log of out.values()) log.sort((a, b) => a.m - b.m);
  return out;
}

// ---------------------------------------------------------------- the deeds

/**
 * ONE STORY PER DEED: the most surprising arc in its history. A deed can be a
 * flip, a haircut, a long climb, a curse or a building that did not last, and
 * the paper prints whichever of those is the strangest — not all of them,
 * which is how one busy corner would otherwise fill the page.
 */
function deedStories(parcels: Parcels, hist: Map<string, PropertyEvent[]>, me: string): Story[] {
  const out: Story[] = [];
  const best = new Map<string, Story>();
  for (const [bbl, log] of hist) {
    const addr = addressOf(parcels, bbl);
    const cands: Story[] = [];
    const beats = log.map(beatOf);
    const trades = log.filter((e) => e.kind === "trade" && (e.amount ?? 0) > 0);
    const mine = log.some((e) => e.party === me || e.otherParty === me);

    // THE TURN — two consecutive sales with nothing physical in between, so
    // the gap is a price and not a building.
    for (let i = 1; i < trades.length; i++) {
      const a = trades[i - 1], b = trades[i];
      const between = log.filter((e) => e.m >= a.m && e.m <= b.m && e !== a && e !== b);
      if (between.some((e) => e.kind !== "trade" && e.kind !== "major-lease")) continue;
      // Same owner selling as bought it, or an owner the record did not name.
      if (named(b.otherParty) && b.otherParty !== a.party) continue;
      const months = b.m - a.m, gain = b.amount! - a.amount!;
      const who = a.party === me ? "You" : cap(a.party ?? "the buyer");
      // A resale is a comp, and a comp is not news. Only the dramatic ones
      // are: half again inside eighteen months and a million and a half
      // made, or more than a third of a big building's price gone.
      if (months <= 18 && b.amount! >= a.amount! * 1.5 && gain >= 1_500_000) {
        const distress = a.outcome === "distress sale";
        cands.push({
          id: `flip:${bbl}:${a.m}`, section: "deeds", bbl, mine: a.party === me || b.party === me,
          kicker: "The quick turn",
          head: `${who} made ${money(gain)} on ${addr} in ${span(months)}`,
          body: `${who} paid ${money(a.amount!)} for it in ${monthLabel(a.m)}${distress ? ", out of somebody else's distress" : ""}. `
            + `In ${monthLabel(b.m)} ${b.party ?? "a buyer"} paid ${money(b.amount!)} — ${pct(b.amount!, a.amount!)} more, with nothing built in between. `
            + (distress ? "The best buying in this business comes off somebody else's bad year." : "Somebody saw something the seller did not."),
          m: b.m, score: 3 + dollarPts(gain) + (months <= 12 ? 1 : 0) + (distress ? 0.5 : 0), beats,
        });
      } else if (a.amount! >= 5_000_000 && b.amount! <= a.amount! * 0.6 && months <= 120) {
        cands.push({
          id: `haircut:${bbl}:${a.m}`, section: "deeds", bbl, mine: a.party === me,
          kicker: "The haircut",
          head: `${who} lost ${pct(b.amount!, a.amount!)} on ${addr}`,
          body: `Bought for ${money(a.amount!)} in ${monthLabel(a.m)}, sold for ${money(b.amount!)} ${span(months)} later`
            + `${b.outcome === "distress sale" ? " in a distress sale" : ""}. ${money(-gain)} of value gone, and the building did not change.`,
          m: b.m, score: 2.5 + dollarPts(gain), beats,
        });
      }
    }

    // THE CURSE — lenders keep taking it back.
    const defaults = log.filter((e) => e.kind === "default");
    if (defaults.length >= 2) {
      const last = defaults[defaults.length - 1];
      const losers = defaults.map((d) => (d.party ?? "").split(" / ")[0]).filter(Boolean);
      cands.push({
        id: `curse:${bbl}`, section: "deeds", bbl, mine,
        kicker: "The building nobody can keep",
        head: `Lenders have taken ${addr} back ${count(defaults.length)} times`,
        body: `${losers.slice(0, 3).join(", then ")}${losers.length > 3 ? ", and more" : ""} — each one bought it believing it would work, and each one handed the keys to the lender. `
          + `The last time was ${monthLabel(last.m)}. Whatever is wrong with it, it is not the owner.`,
        m: last.m, score: 2 + defaults.length * 0.9 + trades.length * 0.1, beats,
      });
    }

    // THE CRANE THAT STOPPED — ground broken, keys handed back before it opened.
    for (const start of log.filter((e) => e.kind === "build-start")) {
      const lost = log.find((e) => e.kind === "default" && e.m >= start.m && e.m - start.m <= 60
        && !log.some((d) => d.kind === "delivered" && d.m >= start.m && d.m <= e.m));
      if (!lost) continue;
      const after = log.find((e) => e.kind === "delivered" && e.m > lost.m);
      cands.push({
        id: `stall:${bbl}:${start.m}`, section: "deeds", bbl, mine,
        kicker: "The crane that stopped",
        head: `${cap(start.party ?? "A developer")} broke ground on ${addr} — and lost it before it opened`,
        body: `${cap(buildingPhrase(start))}, started in ${monthLabel(start.m)}. ${span(lost.m - start.m)} later: ${(lost.outcome ?? "the lender took it").replace(/^deed in lieu; /, "a deed in lieu, and ")}. `
          + (after ? `Somebody else finished it, and it opened in ${monthLabel(after.m)}.` : "The frame is still waiting for whoever is brave enough."),
        m: Math.max(lost.m, after?.m ?? 0), score: 3 + (start.floors ?? 0) * 0.08, beats,
      });
    }

    // A SECOND LIFE — the shell kept, the use changed. The tell of a market
    // that has turned: nobody converts an office that still lets.
    for (const conv of log.filter((e) => e.kind === "converted")) {
      const done = log.find((e) => e.kind === "delivered" && e.m > conv.m);
      const from = conv.use === "office" ? "offices" : conv.use === "retail" ? "shops"
        : conv.use === "industrial" ? "a warehouse" : conv.use === "multifamily" ? "apartments" : "what it was";
      cands.push({
        id: `convert:${bbl}:${conv.m}`, section: "deeds", bbl, mine,
        kicker: "A second life",
        head: `${addr} was ${from}. ${done ? "It is something else now." : "Not for much longer."}`,
        body: `${cap(conv.outcome ?? "Its owner is converting it")}${conv.sf ? ` — ${Math.round(conv.sf).toLocaleString()} sf of ${from === "what it was" ? "space" : from} that the market stopped paying for` : ""}. `
          + (done ? `It reopened in ${monthLabel(done.m)} as ${buildingPhrase(done)}.` : `Work began in ${monthLabel(conv.m)}; the shell stays, the use goes.`),
        m: done?.m ?? conv.m, score: 3.2 + (conv.sf ?? 0) / 100_000,
      });
    }

    // THE SHORT LIFE — a building that opened and came down again.
    for (const del of log.filter((e) => e.kind === "delivered")) {
      const down = log.find((e) => e.kind === "demolished" && e.m > del.m);
      if (!down) continue;
      const years = Math.max(1, Math.round((down.m - del.m) / 12));
      cands.push({
        id: `short:${bbl}:${del.m}`, section: "deeds", bbl, mine,
        kicker: "Gone too soon",
        head: `${addr} stood for ${years} year${years === 1 ? "" : "s"}`,
        body: `${cap(buildingPhrase(del))} opened in ${monthLabel(del.m)} and was knocked down in ${monthLabel(down.m)} to make way for something bigger. `
          + `Somebody paid for every one of those floors.`,
        m: down.m, score: 2 + Math.max(0, 20 - years) * 0.12, beats,
      });
    }

    if (cands.length) best.set(bbl, cands.sort((a, b) => b.score - a.score)[0]);
  }

  out.push(...best.values());
  return out;
}

// --------------------------------------------------------- the player's book

function yourStories(g: GameState, parcels: Parcels, hist: Map<string, PropertyEvent[]>, me: string): Story[] {
  const out: Story[] = [];

  // WHAT HAPPENED AFTER YOU SOLD. The player sees their exit once, on the
  // day; what the next owner did with it is on another deed's page they have
  // no reason to open.
  const seen = new Set<string>();
  for (const x of [...(g.exits ?? [])].reverse()) {
    if (seen.has(x.bbl) || g.holdings[x.bbl] || !(x.price > 0)) continue;
    seen.add(x.bbl);
    const after = (hist.get(x.bbl) ?? []).filter((e) => e.m > x.soldM);
    const built = after.find((e) => e.kind === "delivered");
    const fell = after.find((e) => e.kind === "default");
    const trades = after.filter((e) => e.kind === "trade" && (e.amount ?? 0) > 0 && e.party !== me);
    const last = trades[trades.length - 1];
    const addr = x.address || addressOf(parcels, x.bbl);
    const beats = (hist.get(x.bbl) ?? []).map(beatOf);
    if (built) {
      out.push({
        id: `after-built:${x.bbl}`, section: "yours", bbl: x.bbl, mine: true,
        kicker: "Where are they now",
        head: `The site you sold at ${addr} is ${buildingPhrase(built)} now`,
        body: `You let it go for ${money(x.price)} in ${monthLabel(x.soldM)}. ${cap(built.party ?? "The next owner")} opened ${buildingPhrase(built)} on it in ${monthLabel(built.m)}`
          + (last && last.m > built.m ? `, and it has since traded for ${money(last.amount!)}.` : "."),
        m: Math.max(built.m, last?.m ?? 0), score: 3.5 + (built.floors ?? 0) * 0.1, beats,
      });
    } else if (last && last.m - x.soldM <= 72 && last.amount! >= x.price * 1.6 && last.amount! - x.price >= 500_000) {
      // Only soon and only by a lot: a building that fetched more fifteen
      // years later did what buildings do, and that is not a story.
      out.push({
        id: `got-away:${x.bbl}`, section: "yours", bbl: x.bbl, mine: true,
        kicker: "The one that got away",
        head: `You sold ${addr} for ${money(x.price)}. It ${g.month - last.m <= 12 ? "just went" : "has since gone"} for ${money(last.amount!)}.`,
        body: `${monthLabel(x.soldM)} to ${monthLabel(last.m)}: ${pct(last.amount!, x.price)} more, ${span(last.m - x.soldM)} after you were out. `
          + `${cap(last.party ?? "The buyer")} paid it${trades.length > 1 ? ` — the ${trades.length} sales since yours all went the same way` : ""}.`,
        m: last.m, score: 3 + dollarPts(last.amount! - x.price), beats,
      });
    } else if (fell || (last && last.amount! <= x.price * 0.75)) {
      const when = fell ? fell.m : last!.m;
      out.push({
        id: `dodged:${x.bbl}`, section: "yours", bbl: x.bbl, mine: true,
        kicker: "The bullet you dodged",
        head: fell
          ? `The buyer of ${addr} lost it to the lender`
          : `You sold ${addr} for ${money(x.price)}. Now it fetches ${money(last!.amount!)}.`,
        body: fell
          ? `You were out in ${monthLabel(x.soldM)} at ${money(x.price)}. By ${monthLabel(fell.m)}: ${(fell.outcome ?? "the lender took title").replace(/^deed in lieu; /, "a deed in lieu, and ")}. Good timing, or good luck — either way, not your problem.`
          : `${pct(last!.amount!, x.price)} lower, ${span(last!.m - x.soldM)} after you got out. Whatever you saw, you were right.`,
        m: when, score: 3 + (fell ? 0.8 : dollarPts(x.price - last!.amount!)), beats,
      });
    }
  }

  // WHAT IS HAPPENING ON YOUR BLOCK. A crane next door is next year's
  // competition for your tenants, and a default next door is a building that
  // will be priced to go. (A plain sale next door is a comp; the comps sheet
  // has those, and the paper does not reprint it.)
  const blockOf = new Map<string, string[]>();
  for (const [bbl, rec] of Object.entries(parcels)) {
    const k = `${rec.district}|${rec.block}`;
    const arr = blockOf.get(k);
    if (arr) arr.push(bbl); else blockOf.set(k, [bbl]);
  }
  const recent = g.month - 24;
  const told = new Set<string>();
  for (const bbl of Object.keys(g.holdings)) {
    const rec = parcels[bbl];
    if (!rec) continue;
    const next = (blockOf.get(`${rec.district}|${rec.block}`) ?? []).filter((b) => b !== bbl && !g.holdings[b]);
    let best: Story | null = null;
    for (const nb of next) {
      if (told.has(nb)) continue;
      for (const e of hist.get(nb) ?? []) {
        if (e.m < recent) continue;
        const there = addressOf(parcels, nb), yours = addressOf(parcels, bbl);
        let s: Story | null = null;
        if (e.kind === "build-start") {
          s = {
            id: `block-crane:${nb}:${e.m}`, section: "yours", bbl: nb, mine: true,
            kicker: "On your block",
            head: `A crane is going up next to your ${yours}`,
            body: `${cap(e.party ?? "A developer")} broke ground on ${buildingPhrase(e)} at ${there} in ${monthLabel(e.m)}${e.sf ? ` — ${Math.round(e.sf).toLocaleString()} sf` : ""}. `
              + (e.use && rec.class === e.use ? "Same use as yours: when it opens, it is competing for your tenants." : "A new building on the block tends to lift everything around it — or flood it."),
            m: e.m, score: 4 + (e.floors ?? 0) * 0.05,
          };
        } else if (e.kind === "default") {
          s = {
            id: `block-default:${nb}:${e.m}`, section: "yours", bbl: nb, mine: true,
            kicker: "On your block",
            head: `The lender took back ${there}, on the same block as your ${yours}`,
            body: `${(e.outcome ?? "The secured party took title").replace(/^deed in lieu; /, "A deed in lieu: ")} in ${monthLabel(e.m)}. `
              + `A building in a lender's hands is priced to go — and whatever it sells for is the comp everyone will use on yours.`,
            m: e.m, score: 3.6,
          };
        }
        if (s && (!best || s.m > best.m || (s.m === best.m && s.score > best.score))) best = s;
      }
    }
    if (best) { told.add(best.bbl!); out.push(best); }
  }

  // WHAT YOUR BUILDING WAS BEFORE YOU. The deed history is on the property
  // page; nobody opens it for a building they already own.
  for (const bbl of Object.keys(g.holdings)) {
    const log = hist.get(bbl) ?? [];
    const myBuy = [...log].reverse().find((e) => e.kind === "trade" && e.party === me);
    const before = log.filter((e) => !myBuy || e.m < myBuy.m);
    const defaults = before.filter((e) => e.kind === "default");
    const owners = new Set(before.filter((e) => e.kind === "trade").map((e) => e.party));
    if (defaults.length >= 1 && owners.size >= 2) {
      const d = defaults[defaults.length - 1];
      out.push({
        id: `past:${bbl}`, section: "yours", bbl, mine: true,
        kicker: "Your building's past",
        head: `Before you, ${addressOf(parcels, bbl)} broke ${defaults.length === 1 ? "an owner" : `${count(defaults.length)} owners`}`,
        body: `${owners.size} owners before you. In ${monthLabel(d.m)} it was ${(d.party ?? "its owner").split(" / ")[0]} handing the keys to ${(d.party ?? "").split(" / ")[1] ?? "the lender"}. `
          + `Whatever went wrong for them is worth knowing before it goes wrong for you.`,
        m: d.m, score: 2.2 + defaults.length * 0.5, beats: log.map(beatOf),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- the street

function streetStories(g: GameState, hist: Map<string, PropertyEvent[]>): Story[] {
  const out: Story[] = [];
  const bought = new Map<string, number>(), lost = new Map<string, number>(), sold = new Map<string, number>();
  const recentBuys = new Map<string, { n: number; distress: number; spend: number }>();
  for (const log of hist.values()) {
    for (const e of log) {
      if (e.kind === "trade" && e.party) {
        bought.set(e.party, (bought.get(e.party) ?? 0) + 1);
        if (e.otherParty) sold.set(e.otherParty, (sold.get(e.otherParty) ?? 0) + 1);
        if (e.m > g.month - 24 && named(e.party)) {
          const r = recentBuys.get(e.party) ?? { n: 0, distress: 0, spend: 0 };
          r.n++; r.spend += e.amount ?? 0;
          if (e.outcome === "distress sale") r.distress++;
          recentBuys.set(e.party, r);
        }
      }
      if (e.kind === "default" && e.party) {
        const who = e.party.split(" / ")[0];
        lost.set(who, (lost.get(who) ?? 0) + 1);
      }
    }
  }

  // OBITUARIES. A firm that failed is removed from every table the next
  // month; the paper is the only place it gets a last paragraph.
  for (const r of g.rivals) {
    if (r.failedM === undefined || r.takenPrivateM !== undefined || r.takenOverBy || r.retiredM !== undefined
      || r.failedM < g.month - 60) continue;
    const n = bought.get(r.name) ?? 0, l = lost.get(r.name) ?? 0;
    const years = Math.max(1, Math.round((r.failedM - (r.bornM ?? 0)) / 12));
    out.push({
      id: `obit:${r.id}`, section: "street",
      kicker: "Obituary",
      head: `${r.name}, ${yr(r.bornM ?? 0)}–${yr(r.failedM)}`,
      body: `${years} year${years === 1 ? "" : "s"} on the street. `
        + (n ? `The deeds remember ${count(n)} purchase${n === 1 ? "" : "s"}${l ? ` and ${count(l)} handed back to a lender` : ""}. ` : l ? `${cap(count(l))} buildings handed back to lenders. ` : "")
        + ((r.distributed ?? 0) > 0 ? `Over its life it sent ${money(r.distributed!)} home to its partners${(r.taxPaid ?? 0) > 0 ? ` and ${money(r.taxPaid!)} to the tax man` : ""}. ` : "")
        + (r.spawnedFrom ? `It had spun out of ${r.spawnedFrom.firmName}. ` : "")
        + `The buildings are somebody else's now.`,
      m: r.failedM, score: 2.4 + Math.min(n, 20) * 0.08 + l * 0.15,
    });
  }

  // THE STUDENT AND THE TEACHER — a spin-off measured against the firm it
  // walked out of.
  for (const r of g.rivals) {
    if (!r.spawnedFrom || r.failedM !== undefined) continue;
    const parent = g.rivals.find((p) => p.id === r.spawnedFrom!.firmId);
    const mineN = r.bbls.length, theirs = parent && parent.failedM === undefined ? parent.bbls.length : 0;
    const passed = !parent || parent.failedM !== undefined || mineN > theirs;
    out.push({
      id: `spinoff:${r.id}`, section: "street",
      kicker: passed ? "The student passed the teacher" : "Out on their own",
      head: `${r.name} spun out of ${r.spawnedFrom.firmName}`,
      body: `That was ${monthLabel(r.bornM ?? 0)}. Today ${r.name} holds ${count(mineN)} building${mineN === 1 ? "" : "s"}`
        + (parent?.failedM !== undefined && parent
          ? `, and ${r.spawnedFrom.firmName} is gone — wound up in ${yr(parent.failedM)}.`
          : `; ${r.spawnedFrom.firmName} holds ${count(theirs)}.`)
        + (passed ? " The old shop is not saying much about it." : " It is early."),
      m: r.bornM ?? 0, score: 2 + (passed ? 1 : 0) + mineN * 0.05,
    });
  }

  // WHO IS BUYING. The comps sheet lists trades; it does not add them up.
  const top = [...recentBuys.entries()].sort((a, b) => b[1].n - a[1].n || b[1].spend - a[1].spend)[0];
  if (top && top[1].n >= 8) {
    const [name, r] = top;
    const lastM = Math.max(...[...hist.values()].flat().filter((e) => e.kind === "trade" && e.party === name).map((e) => e.m));
    out.push({
      id: `buyer:${name}:${Math.floor(g.month / 6)}`, section: "street",
      kicker: "Who's buying",
      head: `${name} has bought ${count(r.n)} buildings in two years`,
      body: `${money(r.spend)} in all${r.distress ? `, ${r.distress === r.n ? "every one of them" : `${count(r.distress)} of them`} out of somebody's distress` : ""}. `
        + `No other name on the deeds comes close. Either they know something, or they are about to find something out.`,
      m: lastM, score: 2.5 + Math.min(r.n, 12) * 0.12 + (r.distress / r.n),
    });
  }
  return out;
}

// --------------------------------------------------- the skyline and records

function skylineStories(g: GameState, parcels: Parcels, hist: Map<string, PropertyEvent[]>): { stories: Story[]; almanac: Paper["almanac"] } {
  const out: Story[] = [];
  const all: (PropertyEvent & { bbl: string })[] = [];
  for (const [bbl, log] of hist) for (const e of log) all.push({ ...e, bbl });
  all.sort((a, b) => a.m - b.m);

  // TALLEST IN THE CITY. The record starts at the city as generated and is
  // broken only by something that actually opened.
  let tallest = 0, tallestBbl = "";
  for (const [bbl, p] of Object.entries(parcels)) if (p.floors > tallest) { tallest = p.floors; tallestBbl = bbl; }
  let record: { e: PropertyEvent & { bbl: string }; prev: number; prevBbl: string } | null = null;
  for (const e of all) {
    if (e.kind === "delivered" && (e.floors ?? 0) > tallest) {
      record = { e, prev: tallest, prevBbl: tallestBbl };
      tallest = e.floors!; tallestBbl = e.bbl;
    }
  }
  if (record) {
    const { e } = record;
    out.push({
      id: `tallest:${e.bbl}:${e.m}`, section: "skyline", bbl: e.bbl,
      kicker: "New height record",
      head: `${addressOf(parcels, e.bbl)} is the tallest building in the city`,
      body: `${e.floors} floors, opened ${monthLabel(e.m)} by ${mid(e.party, "its developer")}. The old record was ${record.prev} floors, at ${addressOf(parcels, record.prevBbl)}. `
        + `Nothing taller is under construction${anyTaller(g, e.floors!) ? " — except one job, which is" : ""}.`,
      m: e.m, score: 3.5 + (e.floors! - record.prev) * 0.2,
    });
  }

  // THE OLDEST THING TO COME DOWN.
  // The generated year only dates the ORIGINAL building: a lot rebuilt once
  // and knocked down again is not a century-old loss.
  const downs = all.filter((e) => e.kind === "demolished" && (parcels[e.bbl]?.yearBuilt ?? 0) > 1700
    && !(hist.get(e.bbl) ?? []).some((x) => x.kind === "delivered" && x.m < e.m));
  if (g.month >= 60 && downs.length >= 3) {
    const oldest = downs.reduce((a, e) => (parcels[e.bbl].yearBuilt < parcels[a.bbl].yearBuilt ? e : a));
    const built = parcels[oldest.bbl].yearBuilt;
    if (yr(oldest.m) - built >= 60) {
      out.push({
        id: `oldest-down:${oldest.bbl}`, section: "skyline", bbl: oldest.bbl,
        kicker: "End of an era",
        head: `${addressOf(parcels, oldest.bbl)} stood from ${built} to ${yr(oldest.m)}`,
        body: `${yr(oldest.m) - built} years — the oldest of the ${count(downs.length)} buildings this city has knocked down since ${START_YEAR}. `
          + `${(g.landmarks ?? {})[oldest.bbl] !== undefined ? "It had been landmarked, for all the good it did." : "Nobody landmarked it, and now nobody can."}`,
        m: oldest.m, score: 2 + (yr(oldest.m) - built) * 0.01,
      });
    }
  }

  // THE ALMANAC — something from this month, five or ten or twenty years ago.
  const almanac: Paper["almanac"] = [];
  for (const sw of g.swanLog ?? []) {
    const ago = g.month - sw.m;
    if (ago > 0 && ago % 12 === 0) almanac.push({ m: sw.m, text: `${Math.round(ago / 12)} years ago this month: ${sw.title}.` });
  }
  for (const yAgo of [5, 10, 20, 25, 30, 40, 50]) {
    const m = g.month - yAgo * 12;
    const then = all.filter((e) => e.m === m);
    // What went UP that month, not what changed hands: a sale ten years ago
    // is a comp ten years stale.
    const big = then.filter((e) => e.kind === "delivered").sort((a, b) => (b.floors ?? 0) - (a.floors ?? 0))[0];
    if (!big) continue;
    const addr = addressOf(parcels, big.bbl);
    almanac.push({
      m, bbl: big.bbl,
      text: `${cap(count(yAgo))} years ago this month, ${buildingPhrase(big)} opened at ${addr}`
        + (big.party ? `, built by ${mid(big.party, "its developer")}.` : ".")
        + standing(hist.get(big.bbl) ?? [], big),
    });
  }
  return { stories: out, almanac: almanac.slice(0, 3) };
}

/** What became of a building in the almanac: still up, or gone. */
function standing(log: PropertyEvent[], e: PropertyEvent): string {
  const down = log.find((x) => x.m > e.m && x.kind === "demolished");
  return down ? ` It came down in ${yr(down.m)}.` : " It is still standing.";
}

function anyTaller(g: GameState, floors: number): boolean {
  return Object.values(g.developments ?? {}).some((d) => (d as { floors?: number }).floors! > floors)
    || (g.cityJobs ?? []).some((j) => (j.floors ?? 0) > floors);
}

// ---------------------------------------------------------------- the places

function metres(a: [number, number], b: [number, number]): number {
  const k = Math.cos((a[1] * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * 111_320 * k, (a[1] - b[1]) * 110_540);
}

function placeStories(g: GameState, parcels: Parcels, hist: Map<string, PropertyEvent[]>): Story[] {
  const out: Story[] = [];

  // WHAT A STATION DID TO ITS NEIGHBOURHOOD. Sales and groundbreakings
  // within a few blocks, after the announcement against the same span
  // before — and the same count for the whole city, because a station
  // announced into a boom would otherwise take the credit for the boom.
  for (const line of g.lines ?? []) {
    const site = line.siteBbl ?? line.bbl;
    const here = site ? parcels[site]?.centroid : undefined;
    if (!here) continue;
    const window = Math.min(60, g.month - line.annM, line.annM);
    if (window < 24) continue;
    let tB = 0, tA = 0, bB = 0, bA = 0, cB = 0, cA = 0;
    for (const [bbl, log] of hist) {
      const c = parcels[bbl]?.centroid;
      const near = !!c && metres(c, here) <= 250;
      for (const e of log) {
        if (e.kind !== "trade" && e.kind !== "build-start") continue;
        const before = e.m < line.annM && e.m >= line.annM - window;
        const after = e.m >= line.annM && e.m < line.annM + window;
        if (before) cB++;
        if (after) cA++;
        if (!near) continue;
        if (e.kind === "trade") { if (before) tB++; if (after) tA++; }
        else { if (before) bB++; if (after) bA++; }
      }
    }
    if (tA + bA < 3 || tB + bB < 1 || cB < 1) continue;
    const local = (tA + bA) / (tB + bB), city = cA / cB;
    const kind = line.kind ?? "station";
    const lift = Math.round((local / city - 1) * 100);
    out.push({
      id: `station:${line.id}`, section: "places", bbl: site,
      kicker: `What the ${kind} did`,
      head: lift >= 20
        ? `Near the ${line.name} ${kind}, deal-making is up ${Math.round((local - 1) * 100)}% since it was announced`
        : `The ${line.name} ${kind} has not moved its neighbourhood — yet`,
      body: `Announced ${monthLabel(line.annM)}${line.openM <= g.month ? `, open since ${monthLabel(line.openM)}` : `, due ${monthLabel(line.openM)}`}. `
        + `Within a few blocks, in the ${span(window)} after: ${tA} sale${tA === 1 ? "" : "s"} and ${bA} groundbreaking${bA === 1 ? "" : "s"}, against ${tB} and ${bB} in the ${span(window)} before. `
        + (Math.abs(city - 1) < 0.05
          ? "Across the whole city, activity was flat over the same years. "
          : `Across the whole city, activity was ${city > 1 ? "up" : "down"} ${Math.round(Math.abs(city - 1) * 100)}% over the same years. `)
        + (lift >= 20 ? "Money follows the public works." : lift <= -20 ? "If anything, the money went the other way." : `So far, the ${kind} is just a ${kind}.`),
      m: line.annM + window, score: 2.2 + Math.min(2.5, Math.abs(lift) / 60),
    });
  }

  // THE NEIGHBOURHOOD WITH THE CRANES. Starts per district, last three years.
  const starts = new Map<string, number>();
  let total = 0;
  for (const [bbl, log] of hist) {
    const d = parcels[bbl]?.district;
    if (!d) continue;
    for (const e of log) if (e.kind === "build-start" && e.m > g.month - 36) { starts.set(d, (starts.get(d) ?? 0) + 1); total++; }
  }
  const hot = [...starts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (hot && hot[1] >= 3 && hot[1] / total >= 0.25) {
    const name = districtLabelOf(parcels, hot[0]);
    out.push({
      id: `cranes:${hot[0]}:${Math.floor(g.month / 12)}`, section: "places",
      kicker: "Where the cranes are",
      head: `${name} has had ${count(hot[1])} of the city's ${total} groundbreakings in three years`,
      body: `${Math.round((hot[1] / total) * 100)}% of everything started in the city, in one neighbourhood. `
        + `That is either the next great district or the next glut, and the leases will say which in about four years.`,
      m: g.month, score: 2.2 + (hot[1] / total) * 2,
    });
  }

  // REZONINGS AND WHAT FOLLOWED.
  for (const [d, z] of Object.entries(g.zoneLog ?? {})) {
    if (g.month - z.m < 24) continue;
    const win = Math.min(g.month - z.m, 60);
    let before = 0, after = 0;
    for (const [bbl, log] of hist) {
      if (parcels[bbl]?.district !== d) continue;
      for (const e of log) {
        if (e.kind !== "build-start") continue;
        if (e.m < z.m && e.m >= z.m - win) before++;
        if (e.m >= z.m && e.m < z.m + win) after++;
      }
    }
    if (before + after < 2) continue;
    const name = districtLabelOf(parcels, d);
    out.push({
      id: `rezone:${d}:${z.m}`, section: "places",
      kicker: z.dir > 0 ? "After the upzoning" : "After the downzoning",
      head: `${name} was ${z.dir > 0 ? "upzoned" : "downzoned"} in ${yr(z.m)}. Here is what happened next.`,
      body: `${after} building${after === 1 ? "" : "s"} started in the ${span(win)} after the vote, against ${before} in the ${span(win)} before. `
        + (z.dir > 0
          ? (after > before ? "More envelope, more building — the rule worked the way the planners said." : "More envelope, and still nobody building. The constraint was never the zoning.")
          : (after < before ? "Less envelope, fewer cranes. The neighbourhood got what it voted for." : "Less envelope, and they built anyway — what was left still penciled.")),
      m: z.m + win, score: 2 + Math.abs(after - before) * 0.25,
    });
  }
  return out;
}

// ----------------------------------------------------------- by the numbers

/**
 * The year's activity against every year on record. A number on its own is
 * weather; "the most since 2009" is news.
 */
function numbers(g: GameState, hist: Map<string, PropertyEvent[]>): StoryStat[] {
  const years = Math.floor(g.month / 12);
  if (years < 2) return [];
  type Row = { trades: number; distress: number; defaults: number; starts: number; opens: number; downs: number; volume: number };
  const rows: Row[] = Array.from({ length: years + 1 }, () => ({ trades: 0, distress: 0, defaults: 0, starts: 0, opens: 0, downs: 0, volume: 0 }));
  // A trailing twelve months for "this year", so January does not read as a
  // collapse; earlier rows are calendar years.
  const cut = g.month - 12;
  for (const log of hist.values()) {
    for (const e of log) {
      const i = e.m > cut ? years : Math.min(years - 1, Math.floor(e.m / 12));
      if (i < 0 || (e.m > cut && e.m > g.month)) continue;
      const r = rows[i];
      if (e.kind === "trade") { r.trades++; r.volume += e.amount ?? 0; if (e.outcome === "distress sale") r.distress++; }
      if (e.kind === "default") r.defaults++;
      if (e.kind === "build-start") r.starts++;
      if (e.kind === "delivered") r.opens++;
      if (e.kind === "demolished") r.downs++;
    }
  }
  // The calendar row that overlaps the trailing window double-counts nothing
  // (each event lands in exactly one row) but is short; drop it from history.
  const past = rows.slice(0, years - 1);
  const now = rows[years];
  const note = (v: number, f: (r: Row) => number, fmt: (x: number) => string, high: string, low: string): { note: string; flag?: boolean } => {
    const vals = past.map(f);
    if (!vals.length) return { note: "" };
    const above = vals.map((x, i) => ({ x, i })).filter((p) => p.x >= v);
    const below = vals.map((x, i) => ({ x, i })).filter((p) => p.x <= v);
    if (!above.length && v > 0) return { note: `${high} on record`, flag: true };
    if (!below.length) return { note: `${low} on record`, flag: true };
    const lastAbove = above[above.length - 1].i, lastBelow = below[below.length - 1].i;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (lastAbove < years - 6 && v > avg) return { note: `${high} since ${START_YEAR + lastAbove}`, flag: true };
    if (lastBelow < years - 6 && v < avg) return { note: `${low} since ${START_YEAR + lastBelow}`, flag: true };
    return { note: `typical year: ${fmt(avg)}` };
  };
  const ds = (r: Row) => (r.trades ? r.distress / r.trades : 0);
  const n = (x: number) => (x >= 10 ? String(Math.round(x)) : x.toFixed(1).replace(/\.0$/, ""));
  const out: StoryStat[] = [
    { label: "Distress share", value: `${Math.round(ds(now) * 100)}%`, ...note(ds(now), ds, (x) => `${Math.round(x * 100)}%`, "Highest", "Lowest") },
    { label: "Lender takebacks", value: String(now.defaults), ...note(now.defaults, (r) => r.defaults, n, "Most", "Fewest") },
    { label: "Groundbreakings", value: String(now.starts), ...note(now.starts, (r) => r.starts, n, "Most", "Fewest") },
    { label: "Buildings opened", value: String(now.opens), ...note(now.opens, (r) => r.opens, n, "Most", "Fewest") },
    { label: "Knocked down", value: String(now.downs), ...note(now.downs, (r) => r.downs, n, "Most", "Fewest") },
  ];
  return out;
}

// ---------------------------------------------------------------- the market

const CLASS_NOUN: Record<BuiltClass, string> = {
  office: "office", retail: "shop", multifamily: "apartment", industrial: "warehouse",
};
const CLASS_PLURAL: Record<BuiltClass, string> = {
  office: "offices", retail: "shops", multifamily: "apartments", industrial: "warehouses",
};
const CLASSES: BuiltClass[] = ["office", "retail", "multifamily", "industrial"];

const msf = (sf: number) => (Math.abs(sf) >= 1_000_000 ? `${(sf / 1_000_000).toFixed(1)}M sf` : `${Math.round(sf / 1000).toLocaleString()}k sf`);
const pc = (x: number) => `${(x * 100).toFixed(1)}%`;

/**
 * THE LONG SHIFT. What the city actually occupies, a decade apart, class by
 * class, against what happened to its jobs. A cycle moves every class
 * together; a class that moved a long way from the rest — and from the jobs
 * count — is the city changing what it is. Read off the month-end history the
 * market already keeps; nothing here is modelled, only compared.
 */
function shiftStories(g: GameState): Story[] {
  const h = g.econ.history ?? [];
  const win = h.length > 120 ? 120 : h.length > 60 ? 60 : 0;
  if (!win) return [];
  const now = h[h.length - 1], then = h[h.length - 1 - win];
  if (!now.occupied || !then.occupied || !now.stock || !then.stock) return [];
  const years = win / 12;
  const jobs = now.jobs && then.jobs ? now.jobs / then.jobs : 1;
  const out: Story[] = [];
  for (const c of CLASSES) {
    const o0 = then.occupied[c], o1 = now.occupied[c];
    if (!(o0 > 0) || !(o1 > 0)) continue;
    const r = o1 / o0;
    // A tenth or more either way, and at least ten points off the jobs
    // count: the class did something the economy as a whole did not.
    if (Math.abs(r - 1) < 0.1 || Math.abs(r - jobs) < 0.1) continue;
    const gap = Math.round(Math.abs(r - jobs) * 100);
    const up = r > 1;
    const st = now.stock[c] / then.stock[c];
    const vac0 = then.vac?.[c], vac1 = now.vac?.[c];
    out.push({
      id: `shift:${c}:${Math.floor(g.month / 12)}`, section: "market",
      kicker: up ? "The long shift" : "The long retreat",
      head: up
        ? `This city occupies ${Math.round((r - 1) * 100)}% more ${CLASS_NOUN[c]} space than it did ${count(years)} years ago`
        : `This city occupies ${Math.round((1 - r) * 100)}% less ${CLASS_NOUN[c]} space than it did ${count(years)} years ago`,
      body: `${msf(o0)} of ${CLASS_PLURAL[c]} had a tenant in ${yr(then.q)}; ${msf(o1)} do now. `
        + `Over the same years the city's jobs went ${jobs >= 1 ? "up" : "down"} ${Math.round(Math.abs(jobs - 1) * 100)}%`
        + `${now.population && then.population ? ` and its population ${now.population >= then.population ? "grew" : "shrank"} ${Math.round(Math.abs(now.population / then.population - 1) * 100)}%` : ""}, `
        + `so demand for ${CLASS_PLURAL[c]} ${r > jobs ? "outran" : "fell behind"} the economy that pays for it by ${gap} points. The stock ${st >= 1 ? "grew" : "shrank"} ${Math.round(Math.abs(st - 1) * 100)}% to meet it`
        + (vac0 !== undefined && vac1 !== undefined ? `, and vacancy went from ${pc(vac0)} to ${pc(vac1)}. ` : ". ")
        + (r > jobs ? `Whoever owns ${CLASS_PLURAL[c]} here has been riding a tide, not just the cycle.` : `Whoever owns ${CLASS_PLURAL[c]} here is standing in an outgoing tide.`),
      m: g.month, score: 3 + Math.min(2.5, Math.abs(r - jobs) * 8),
    });
  }
  // The black swans that started a shift, when they are running, get named.
  for (const sw of g.swanLog ?? []) {
    const ago = g.month - sw.m;
    if (ago < 24 || ago > 120) continue;
    out.push({
      id: `swan-on:${sw.key}:${sw.m}`, section: "market",
      kicker: `${cap(count(Math.round(ago / 12)))} years on`,
      head: sw.title,
      body: `It was announced in ${monthLabel(sw.m)}, and it was meant to take ${span(sw.glideM)} to land. `
        + `${ago >= sw.glideM ? "It has landed." : `It is ${Math.round((ago / sw.glideM) * 100)}% of the way there.`} `
        + `The leases signed before it are the last ones still priced as if it had not happened.`,
      m: sw.m + Math.min(ago, sw.glideM), score: 3,
    });
  }
  return out;
}

/**
 * THE GLUT WARNING (and its opposite). Every project the market is building,
 * from the one delivery queue, against what the city absorbed in the last
 * twelve months and the vacancy it is already carrying. The projection is
 * arithmetic, not a forecast: if demand keeps last year's pace, this is where
 * vacancy lands when the cranes come down.
 */
function supplyStories(g: GameState): Story[] {
  const h = g.econ.history ?? [];
  const now = h[h.length - 1];
  if (!now?.stock || !now.occupied || g.month < 24) return [];
  const horizon = 18;
  const out: Story[] = [];
  for (const c of CLASSES) {
    const rows = (g.econ.deliveryQueue ?? []).filter((p) => p.status === "active"
      && p.deliverM > g.month && p.deliverM <= g.month + horizon && (p.sfByUse[c] ?? 0) > 0);
    const coming = rows.reduce((a, p) => a + (p.sfByUse[c] ?? 0), 0);
    const stock = now.stock[c], vacSf = Math.max(0, stock - now.occupied[c]);
    const absorb = g.econ.absorb12?.[c] ?? 0;
    if (!(stock > 0)) continue;
    const vac = vacSf / stock, natural = NATURAL_VAC[c];
    const after = Math.max(0, vacSf + coming - absorb * (horizon / 12)) / (stock + coming);
    if (coming >= stock * 0.03 && after >= Math.max(vac + 0.02, natural * 1.25)) {
      out.push({
        id: `glut:${c}:${Math.floor(g.month / 6)}`, section: "market",
        kicker: "Glut warning",
        head: `${cap(count(rows.length))} ${CLASS_NOUN[c]} project${rows.length === 1 ? "" : "s"} open in the next ${horizon} months — into ${pc(vac)} vacancy`,
        body: `${msf(coming)} of new ${CLASS_PLURAL[c]} is due by ${monthLabel(g.month + horizon)}. `
          + `The city ${absorb >= 0 ? `took up ${msf(absorb)}` : `gave back ${msf(-absorb)}`} of ${CLASS_PLURAL[c]} in the last twelve months. `
          + `If demand keeps that pace, vacancy is ${pc(after)} when the cranes come down — against the ${pc(natural)} a healthy ${CLASS_NOUN[c]} market runs at. `
          + `Landlords with space to let will be competing with buildings that have never had a tenant.`,
        m: g.month, score: 3.5 + Math.min(2, (after - natural) * 20),
      });
    } else if (vac < natural * 0.7 && absorb > 0 && coming < absorb * (horizon / 12) * 0.5) {
      out.push({
        id: `short:${c}:${Math.floor(g.month / 6)}`, section: "market",
        kicker: "Running out of room",
        head: `Only ${pc(vac)} of the city's ${CLASS_PLURAL[c]} are empty, and almost nothing is coming`,
        body: `A healthy ${CLASS_NOUN[c]} market runs at ${pc(natural)}. The city absorbed ${msf(absorb)} last year, and only ${msf(coming)} opens in the next ${horizon} months. `
          + `Tenants will pay up or go without; whoever has space has the leverage.`,
        m: g.month, score: 3 + Math.min(2, (natural - vac) * 30),
      });
    }
  }
  return out;
}

/**
 * THE LEAGUE TABLE, YEAR ON YEAR. Every living firm's year-end equity (the
 * race chart's own marks) and the player's net worth at the same month,
 * ranked each year. The standings page shows today; the paper reports what
 * changed.
 */
function leagueStories(g: GameState, me: string): Story[] {
  const y = Math.floor(g.month / 12);
  if (y < 2) return [];
  const playerEq = (yy: number) => g.nwHistory?.[yy * 12];
  const table = (yy: number) => {
    const rows: { name: string; eq: number; me?: boolean; id?: string }[] = [];
    for (const r of g.rivals) {
      const e = r.eqHist?.find((p) => p[0] === yy);
      if (e) rows.push({ name: r.name, eq: e[1], id: r.id });
    }
    const p = playerEq(yy);
    if (p !== undefined) rows.push({ name: me, eq: p, me: true });
    return rows.sort((a, b) => b.eq - a.eq);
  };
  const cur = table(y), prev = table(y - 1);
  if (cur.length < 3 || prev.length < 3) return [];
  const out: Story[] = [];
  const at = (rows: typeof cur, name: string) => rows.findIndex((x) => x.name === name);
  const m = y * 12;

  // A NEW NUMBER ONE.
  if (cur[0].name !== prev[0].name) {
    const lead = cur[0], was = prev[0];
    const wasNow = at(cur, was.name);
    let reign = 0;
    for (let yy = y - 1; yy >= 1 && table(yy)[0]?.name === was.name; yy--) reign++;
    out.push({
      id: `leader:${lead.name}:${y}`, section: "street", mine: !!lead.me || !!was.me,
      kicker: "A new number one",
      head: lead.me ? "Your firm is now the biggest on the street" : `${lead.name} is now the biggest firm on the street`,
      body: `${money(lead.eq)} of equity at the turn of ${START_YEAR + y}. `
        + `${was.me ? "You" : was.name} held the top spot for ${reign <= 1 ? "a year" : `${reign} years`}`
        + (wasNow < 0 ? ` and is gone from the table now.`
          : ` and ${was.me ? "are" : "is"} ${ordinalOf(wasNow + 1)} now, at ${money(cur[wasNow].eq)}`
            + (cur[wasNow].eq < was.eq * 0.7 ? ` — down ${Math.round((1 - cur[wasNow].eq / was.eq) * 100)}% in a year.` : ".")),
      m, score: 4.5,
    });
  }

  // YOU MOVED.
  const mi = at(cur, me), pi = at(prev, me);
  if (mi >= 0 && pi >= 0 && mi !== pi && Math.abs(mi - pi) >= 2 && !(mi === 0 && cur[0].name !== prev[0].name)) {
    const passed = prev.slice(mi, pi).filter((x) => at(cur, x.name) > mi).map((x) => x.name);
    const passedBy = cur.slice(mi + 1 > pi ? pi : 0, mi).filter((x) => at(prev, x.name) > pi).map((x) => x.name);
    out.push({
      id: `you-rank:${y}`, section: "street", mine: true,
      kicker: mi < pi ? "Up the table" : "Down the table",
      head: mi < pi ? `You climbed from ${ordinalOf(pi + 1)} to ${ordinalOf(mi + 1)} on the street` : `You slipped from ${ordinalOf(pi + 1)} to ${ordinalOf(mi + 1)} on the street`,
      body: mi < pi
        ? `In a year you passed ${listOf(passed)}. ${mi > 0 ? `Next above you: ${cur[mi - 1].name}, ${money(cur[mi - 1].eq - cur[mi].eq)} ahead.` : "There is nobody above you."}`
        : `${listOf(passedBy)} went past you this year. ${cur[mi - 1] ? `The gap to ${cur[mi - 1].name} is ${money(cur[mi - 1].eq - cur[mi].eq)}.` : ""}`,
      m, score: 4,
    });
  }

  // THE CLIMBER — the biggest rise over five years by a living firm.
  const back = table(Math.max(1, y - 5));
  let best: { name: string; from: number; to: number; eq0: number; eq1: number } | null = null;
  for (const row of cur) {
    if (row.me) continue;
    const i0 = at(back, row.name), i1 = at(cur, row.name);
    if (i0 < 0) continue;
    if (!best || i0 - i1 > best.from - best.to) best = { name: row.name, from: i0, to: i1, eq0: back[i0].eq, eq1: row.eq };
  }
  // Shuffling in the bottom half is not news; climbing into the top ten is.
  if (best && best.from - best.to >= 5 && best.to < 10) {
    out.push({
      id: `climber:${best.name}:${y}`, section: "street",
      kicker: "The climber",
      head: `${best.name} has gone from ${ordinalOf(best.from + 1)} to ${ordinalOf(best.to + 1)} in ${count(Math.min(5, y - 1))} years`,
      body: `Equity of ${money(best.eq0)} then, ${money(best.eq1)} now. No firm on the street has moved further up the table in that time. `
        + `Whatever they are doing, the rest of the street is about to start copying it.`,
      m, score: 3.2 + (best.from - best.to) * 0.08,
    });
  }
  return out;
}

function ordinalOf(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${s}`;
}

function listOf(names: string[]): string {
  if (!names.length) return "nobody in particular";
  if (names.length === 1) return names[0];
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} others`;
}

/**
 * AFTER THE BANK. A closing is one alert on one afternoon; what a receiver
 * then does to a town takes two years, and nothing else on any page adds it
 * up. Read from the failure log the closing writes (lenders.ts) and the
 * receiver's sales stamp onto it (notes.ts).
 */
function bankStories(g: GameState): Story[] {
  const out: Story[] = [];
  const fails = g.bankFails ?? [];
  for (const f of fails) {
    const last = f.reopenedM ?? g.month;
    if (g.month - f.m > 120 || g.month - f.m < 1) continue;
    const before = fails.filter((x) => x !== f && x.m < f.m && x.m >= f.m - 36).length;
    const sold = f.sold ?? 0;
    const cents = sold && f.soldFace ? Math.round((100 * (f.soldAsk ?? 0)) / f.soldFace) : 0;
    const what = f.kind === "conduit" ? "conduit" : f.kind === "life" ? "life company" : "bank";
    const open = f.reopenedM === undefined;
    out.push({
      id: `bank:${f.lender}:${f.m}`, section: "market", mine: f.yours > 0,
      kicker: open ? "After the bank" : "Back from the dead",
      head: open
        ? `${span(g.month - f.m)} after ${f.lender} went down, the receiver is still emptying the cabinet`
        : `${f.lender} is lending again, ${span(f.reopenedM! - f.m)} after it was closed`,
      body: `The ${what} was closed in ${monthLabel(f.m)} holding ${money(f.book)} of loans, ${pc(f.delinq)} of them not paying`
        + (before ? ` — the ${ordinalOf(before + 1)} lender to fail here in three years` : "") + `. `
        + (sold
          ? `Since then the receiver has put ${count(sold)} loan${sold === 1 ? "" : "s"} on the block, ${money(f.soldFace ?? 0)} of face, asking ${cents} cents on the dollar on average. `
          : `The receiver has not had to sell a loan yet. `)
        + (f.yours > 0 ? `It was lending you ${money(f.yours)} when it went. ` : "")
        + (open ? "A receiver does not extend and does not haggle; every borrower it holds is refinancing somewhere else, or not at all."
          : "The bad paper stayed with the receiver. The name on the door is the same; the credit committee is not."),
      m: last, score: 3.5 + (open ? 0.8 : 0) + dollarPts(f.book) * 0.3 + (f.yours > 0 ? 1 : 0),
    });
  }
  return out;
}

/**
 * TENANTS ON THE MOVE. A year's biggest moves, from the record the engine
 * writes when an anchor walks out on a firm (sized by that firm's own
 * occupancy drop) and when a tenant leaves or signs in the player's
 * buildings (named, because those rent rolls have names).
 */
function tenantStories(g: GameState, parcels: Parcels): Story[] {
  const out: Story[] = [];
  // A rival's "anchor" in a three-building book can be 4k sf; that is churn,
  // not news. A move makes the roundup at 20k sf, and the roundup runs only
  // when the year's biggest is 25k or more.
  const moves = (g.tenantMoves ?? []).filter((x) => x.m > g.month - 12 && x.sf >= (x.kind === "walk" ? 20_000 : 8_000));
  const where = (x: { bbl?: string }) => (x.bbl ? addressOf(parcels, x.bbl) : "");
  const line = (x: (typeof moves)[number]) =>
    x.kind === "walk" ? `an anchor walked out on ${x.who} — about ${msf(x.sf)}, ${x.pts ?? 0} points off its whole book (${monthLabel(x.m)})`
      : x.kind === "leave" ? `${x.who} left your ${where(x)} — ${msf(x.sf)}${x.to ? `, to ${x.to}` : ""} (${monthLabel(x.m)})`
        : `${x.who} signed ${msf(x.sf)} at your ${where(x)} (${monthLabel(x.m)})`;
  const big = [...moves].sort((a, b) => b.sf - a.sf).slice(0, 3);
  if (big.length >= 2 && big[0].sf >= 25_000) {
    const gone = moves.filter((x) => x.kind !== "sign").reduce((a, x) => a + x.sf, 0);
    out.push({
      id: `tenants:${Math.floor(g.month / 3)}`, section: "market",
      kicker: "Tenants on the move",
      head: `${msf(big[0].sf)}: the biggest tenant move of the last twelve months`,
      body: `${cap(big.map(line).join("; "))}. `
        + (gone > 0 ? `${msf(gone)} went back on the market from big moves alone this year — every square foot of it competing with yours.` : ""),
      m: big[0].m, score: 3 + dollarPts(big[0].sf * 30) * 0.4,
    });
  }
  for (const x of moves) {
    if (x.kind === "walk" || !x.bbl || !g.holdings[x.bbl]) continue;
    if (x.kind === "leave" && x.sf >= 8000) {
      out.push({
        id: `leave:${x.bbl}:${x.m}`, section: "yours", bbl: x.bbl, mine: true,
        kicker: "Moving out",
        head: `${x.who} has left your ${where(x)}${x.to ? ` for ${x.to}` : ""}`,
        body: `${msf(x.sf)} came back in ${monthLabel(x.m)}. Space that has been somebody's for years does not let itself; the market it goes back into is the one in the paper today.`,
        m: x.m, score: 3.4 + x.sf / 50_000,
      });
    } else if (x.kind === "sign") {
      const before = (g.tenantMoves ?? []).filter((y) => y.kind === "sign" && y.m < x.m && y.sf >= x.sf);
      out.push({
        id: `sign:${x.bbl}:${x.m}`, section: "yours", bbl: x.bbl, mine: true,
        kicker: "Signed",
        head: `${x.who} took ${msf(x.sf)} at your ${where(x)}`,
        body: before.length
          ? `A big lease, signed ${monthLabel(x.m)}: a tenant that size is a building's whole year.`
          : `The biggest lease your firm has signed, in ${monthLabel(x.m)}. A tenant that size is a building's whole decade.`,
        m: x.m, score: 3 + (before.length ? 0 : 1) + x.sf / 60_000,
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------- the lot

export function writePaper(g: GameState, parcels: Parcels): Paper {
  const me = firmShort(g);
  const hist = histories(g);
  const sky = skylineStories(g, parcels, hist);
  const stories = [
    ...yourStories(g, parcels, hist, me),
    ...deedStories(parcels, hist, me),
    ...streetStories(g, hist),
    ...sky.stories,
    ...placeStories(g, parcels, hist),
    ...shiftStories(g),
    ...supplyStories(g),
    ...leagueStories(g, me),
    ...bankStories(g),
    ...tenantStories(g, parcels),
  ];
  // A deed story about the player's own building belongs in their corner.
  for (const s of stories) if (s.mine && s.section === "deeds") s.section = "yours";
  return { stories, numbers: numbers(g, hist), almanac: sky.almanac };
}

/**
 * How much a story deserves the page THIS month: surprise, plus a bonus for
 * being fresh that fades over about a year and a half. Old stories never
 * reach zero — the best arc in the city is still worth reading in year
 * thirty — but a new one has to be beaten, not just outlasted. The player's
 * own stories get no bonus here: they have a section of their own, and a
 * neighbour's ordinary sale should not lead the paper over the city's news.
 */
export function storyRank(s: Story, month: number): number {
  const age = Math.max(0, month - s.m);
  return s.score + 3 * Math.exp(-age / 18);
}

/**
 * A small deterministic shuffle among stories of similar rank, keyed to the
 * season, so the deeper features rotate rather than sit on the page for a
 * decade. It is a hash, not the game's RNG: reading the paper must never move
 * a random stream.
 */
export function rotation(id: string, month: number): number {
  let h = 2166136261 ^ Math.floor(month / 3);
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}
