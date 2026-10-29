// THE CAUSE LEDGER (ONE_ECONOMY_PLAN.md §6e).
//
// A deep simulation that cannot say why reads the same as a shallow one. So
// every decision that moves a number the player sees is written down AT THE
// MOMENT IT IS TAKEN, with links to the events that caused it: the reasons
// cannot be reconstructed afterwards, because by then the state that held
// them has moved on.
//
//   rent roll −$120k/yr ← Acme Tools went dark ← Acme's sales −35% since it
//   signed ← machinery orders down (trade −2%/mo) ← national output gap −3%
//
// It records; it never decides. Nothing in the economy reads it, no RNG is
// drawn here, and a world with the ledger is byte-identical to one without.
//
// UPSTREAM EVENTS ARE MADE ON DEMAND. A trade's month or the nation's month is
// written only the first time something downstream cites it (`whyTrade`,
// `whyNation`), so the ledger holds the chains that reached a player-visible
// event and nothing else — a few thousand events, not a log of every agent.
//
// RULE FOR EVERY MECHANIC FROM HERE ON: it is not done until the events it
// causes are written here with their causes.
import type { GameState, Sector } from "./types";
import { industryOfFirm, whyIndustry, whyFirmLoss } from "./economy";
import { INDUSTRY_INDEX, TRADE_TO_INDUSTRY, type IndustryId } from "./industries";

export type WhyActor = "tenant" | "firm" | "rival" | "bank" | "city" | "household" | "player" | "nation" | "trade";

export interface WhyEvent {
  id: number;
  /** game month */
  m: number;
  /** a dotted kind: "tenant.dark", "tenant.left", "trade.month", "nation.month"... */
  k: string;
  /** who acted, and their id where they have one (a rival id, a sector, a bbl) */
  a?: WhyActor; aid?: string; name?: string;
  /** the place it happened, for the map trace */
  bbl?: string;
  /** the facts, numbers first */
  n?: Record<string, number>;
  /** one short plain line */
  t: string;
  /** what caused it: earlier events */
  c?: number[];
}

export interface WhyLedger {
  next: number;
  ev: WhyEvent[];
  /** "trade:<sector>:<month>" etc. -> id, for events made on demand once a month */
  key: Record<string, number>;
}

/** How long the ledger remembers, and how much. Bounded so a century's save stays small. */
export const WHY_KEEP_MONTHS = 120;
export const WHY_MAX = 4000;

function ledger(s: GameState): WhyLedger {
  return (s.why ??= { next: 1, ev: [], key: {} });
}

/** Write one event and return its id. Causes may be ids or undefined (dropped). */
export function why(s: GameState, e: Omit<WhyEvent, "id" | "m"> & { m?: number }, causes?: (number | undefined)[]): number {
  const L = ledger(s);
  const id = L.next++;
  const c = (causes ?? e.c ?? []).filter((x): x is number => typeof x === "number" && x > 0);
  const ev: WhyEvent = { ...e, id, m: e.m ?? s.month };
  if (c.length) ev.c = c; else delete ev.c;
  L.ev.push(ev);
  if (L.ev.length > WHY_MAX * 1.1) trimWhy(s);
  return id;
}

/** An event made at most once per key (a trade's month, the nation's month). */
export function whyOnce(s: GameState, key: string, make: () => Omit<WhyEvent, "id" | "m">, causes?: () => (number | undefined)[]): number {
  const L = ledger(s);
  const hit = L.key[key];
  if (hit && L.ev.length && hit >= L.ev[0].id) return hit;
  const id = why(s, make(), causes?.());
  L.key[key] = id;
  return id;
}

/** Drop what is older than the window or over the cap; forget keys that point at nothing. */
export function trimWhy(s: GameState): void {
  const L = s.why;
  if (!L) return;
  const cut = s.month - WHY_KEEP_MONTHS;
  let i = 0;
  while (i < L.ev.length && (L.ev[i].m < cut || L.ev.length - i > WHY_MAX)) i++;
  if (i > 0) L.ev = L.ev.slice(i);
  const lo = L.ev.length ? L.ev[0].id : L.next;
  for (const k of Object.keys(L.key)) if (L.key[k] < lo) delete L.key[k];
}

export function whyGet(s: GameState, id: number | undefined): WhyEvent | undefined {
  const L = s.why;
  if (!L || !id || !L.ev.length) return undefined;
  // ids are dense and increasing: index from the first kept
  const at = id - L.ev[0].id;
  const e = L.ev[at];
  return e && e.id === id ? e : L.ev.find((x) => x.id === id);
}

/**
 * THE CHAIN: from an event back through its first-listed (largest) cause, at
 * most `depth` steps. The first cause is by convention the biggest one; the
 * others are there for the full tree (`whyTree`).
 */
export function whyChain(s: GameState, id: number | undefined, depth = 5): WhyEvent[] {
  const out: WhyEvent[] = [];
  const seen = new Set<number>();
  let e = whyGet(s, id);
  while (e && out.length < depth && !seen.has(e.id)) {
    out.push(e);
    seen.add(e.id);
    e = whyGet(s, e.c?.[0]);
  }
  return out;
}

/** Every cause, as a tree (for the expanded view). */
export function whyTree(s: GameState, id: number | undefined, depth = 5): { e: WhyEvent; c: ReturnType<typeof whyTree> }[] {
  if (depth <= 0) return [];
  const e = whyGet(s, id);
  if (!e) return [];
  return [{ e, c: (e.c ?? []).flatMap((x) => whyTree(s, x, depth - 1)) }];
}

// ---------------------------------------------------------------- upstream, on demand

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

/** The nation's month: the output gap and the policy rate, as the city felt them. */
export function whyNation(s: GameState): number {
  const n = s.econ?.nat;
  return whyOnce(s, `nation:${s.month}`, () => ({
    k: "nation.month", a: "nation",
    n: { gap: n?.gap ?? 0, unemp: n?.unemp ?? 0, policy: n?.policy ?? 0, infl: n?.infl ?? 0 },
    t: `National economy · output gap ${pct(n?.gap ?? 0)} · unemployment ${((n?.unemp ?? 0) * 100).toFixed(1)}% · policy rate ${(n?.policy ?? 0).toFixed(2)}%`,
  }));
}

/**
 * A trade's month: where its orders were heading. Since ONE ECONOMY step 2 a
 * trade is a read-out of the industries its firms are in, so it is caused by
 * the month of the industry it mostly is (economy.ts `whyIndustry`; the
 * heaviest in industries.ts TRADE_TO_INDUSTRY), and the nation's month.
 */
export function whyTrade(s: GameState, sector: string): number {
  const mom = s.econ?.industryMom?.[sector as keyof NonNullable<typeof s.econ.industryMom>] ?? 0;
  return whyOnce(s, `trade:${sector}:${s.month}`, () => ({
    k: "trade.month", a: "trade", aid: sector, name: sector,
    n: { mom },
    t: `${sector} trade · orders ${pct(mom)} a month`,
  }), () => {
    let top: IndustryId | undefined, w = 0;
    for (const fl of ["office", "retail", "industrial"] as const) for (const [k, x] of TRADE_TO_INDUSTRY[fl][sector as Sector] ?? []) if (x > w) { w = x; top = k; }
    return [top ? whyIndustry(s, INDUSTRY_INDEX[top]) : undefined, whyNation(s)];
  });
}

/**
 * A tenant's books as they stood when it decided: sales against where they
 * were when it signed, interest cover, months of cash. Caused by its
 * industry's month (economy.ts `whyIndustry`, ONE ECONOMY step 2: the firm's
 * own industry, whose demand its staff and sales follow), else its trade's
 * month — the firm's own fortunes are the rest of the story, and the numbers
 * carry them.
 */
export function whyTenantBooks(s: GameState, t: { name: string; sector: string; fid?: number; ind?: number },
  fin: { rev0: number; revRef?: number; cover: number; liqM: number }): number {
  const sales = fin.revRef && fin.rev0 > 0 ? fin.revRef / fin.rev0 - 1 : 0;
  return why(s, {
    k: "tenant.books", a: "tenant", name: t.name,
    n: { sales, cover: fin.cover, cashMonths: fin.liqM },
    t: `${t.name} · sales ${pct(sales)} since signing · cover ${fin.cover.toFixed(1)}x · ${fin.liqM.toFixed(1)} months of cash`,
  }, [firstCauseOf(s, t)]);
}
function firstCauseOf(s: GameState, t: { sector: string; fid?: number; ind?: number }): number {
  // a named customer it lost (economy.ts `tickLinks`) before its industry's month
  const lost = t.fid !== undefined ? whyFirmLoss(s, t.fid) : undefined;
  if (lost !== undefined) return lost;
  const ind = industryOfFirm(s, t);
  return (ind !== undefined ? whyIndustry(s, ind) : undefined) ?? whyTrade(s, t.sector);
}
