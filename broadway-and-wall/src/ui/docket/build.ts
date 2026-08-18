/**
 * THE MONTH-CLOSE DOCKET, ASSEMBLED. One pure builder that gathers everything
 * non-blocking that wants the player this month — the standing attention
 * conditions, the watchlist the attention list is not carrying yet, this
 * month's tape — into a single stream, ordered the way the money actually
 * flows: capital first, then deals, then the assets, then the city. A balloon
 * decides whether you can answer a letter of intent; the letter decides what
 * the rent roll looks like; the rent roll is what the city is reacting to.
 *
 * Pure on purpose: (game, parcels, snooze) in, rows out, no store, no clock.
 * Every label is either the engine's own attention label or a date and a
 * balance read straight off the loan — nothing here re-derives a number a
 * desk would quote differently.
 */
import type { GameState, Loan } from "@/engine/types";
import { monthLabel } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import { attentionItems, MILESTONES } from "@/engine/sim";
import { netWorth } from "@/engine/value";
import { usd } from "@/ui/format";
import type { Page } from "@/state/store";

export type DocketCat = "capital" | "deals" | "assets" | "world";

export interface DocketItem {
  key: string;
  cat: DocketCat;
  /** Cannot be pushed to later — a balloon inside six months does not go away because you asked. */
  urgent?: boolean;
  title: string;
  sub?: string;
  bbl?: string;
  /** An attentionItems key: Open routes through the store's openAttention. */
  attnKey?: string;
  page?: Page;
  /** Tail row only: how many rows the cap folded away. */
  more?: number;
}

/** How many rows the rail shows before folding the rest into a tail line. */
const DOCKET_CAP = 10;
/** A snooze is a season, not a dismissal — the item comes back in three months. */
export const SNOOZE_MONTHS = 3;

const CAT_ORDER: Record<DocketCat, number> = { capital: 0, deals: 1, assets: 2, world: 3 };

/**
 * Category from the attention key's head. The heads are the engine's own
 * vocabulary (sim.ts attentionItems); anything unrecognized is deal flow,
 * matching routeAttention's own fallback.
 */
function catForKey(key: string): DocketCat {
  const head = key.split(":")[0];
  if (
    head === "balloon" || head === "sweep" || head.startsWith("facility") ||
    head === "line-over" || head.startsWith("cash") || head === "workout" ||
    // A construction capital call is the firm's own money being demanded,
    // not a deal being negotiated — it reads as capital or it reads wrong.
    head === "capital-call"
  ) return "capital";
  if (
    head === "lease-roll" || head === "nonrenew" || head === "tenant-ask" ||
    head === "capital-plan" || head === "ti-book"
  ) return "assets";
  return "deals";
}

/**
 * What refuses to wait. `near` on a balloon key is the engine saying six
 * months or less (sim.ts), which is barely time to market a refinancing;
 * a sweep, an open workout file and a cash or line problem are already
 * costing money today.
 */
function urgentKey(key: string): boolean {
  const head = key.split(":")[0];
  if (head === "sweep" || head === "facility-sweep" || head === "workout") return true;
  if (head === "cash" || head === "cash-runway" || head === "line-over") return true;
  if (head === "balloon" || head === "facility-balloon") return key.endsWith(":near");
  return false;
}

/** Milestones worth nudging a first-year firm toward, in the order they come. */
const YEAR_ONE_IDS = ["deed1", "lease1", "tower1", "exit1", "nw25"];

export function buildDocket(
  game: GameState,
  parcels: ParcelTable | null,
  snooze: Record<string, number>,
): DocketItem[] {
  const items: DocketItem[] = [];
  const month = game.month;
  const addr = (bbl: string) => parcels?.[bbl]?.address ?? bbl;

  // (a) The standing conditions — everything the engine itself says needs the
  // principal. The label is the engine's, verbatim; Open routes through the
  // same key openAttention already understands.
  for (const a of attentionItems(game, parcels)) {
    items.push({
      key: a.key,
      cat: catForKey(a.key),
      urgent: urgentKey(a.key) || undefined,
      title: a.label,
      attnKey: a.key,
    });
  }

  // (b) The watchlist the attention list does not carry yet. Attention starts
  // shouting at twelve months; a borrower who starts working a refinancing a
  // year ahead needed to see it coming before that.
  const horizon = (bbl: string, ln: Loan | null | undefined, suffix: string) => {
    if (!ln) return;
    const left = ln.maturityM - month;
    if (left > 12 && left <= 18) {
      items.push({
        key: `watch-balloon:${bbl}${suffix}`,
        cat: "capital",
        title: `Balloon on the horizon — ${addr(bbl)}`,
        sub: `${monthLabel(ln.maturityM)} · ${usd(ln.balance)}`,
        bbl,
        page: "debt",
      });
    }
  };
  for (const [bbl, h] of Object.entries(game.holdings)) {
    horizon(bbl, h.loan, "");
    horizon(bbl, h.mezz, ":mezz");

    // A third of the rent roll rolling inside a year is one negotiation
    // pretending to be several — the leasing desk should see it as one file.
    if (!h.groundLeased && h.tenants.length > 0) {
      let leased = 0;
      let rolling = 0;
      for (const t of h.tenants) {
        leased += t.sf;
        if (t.endM - month <= 12) rolling += t.sf;
      }
      if (leased > 0 && rolling / leased > 0.35) {
        items.push({
          key: `roll-cluster:${bbl}`,
          cat: "assets",
          title: `Rollover cluster — ${addr(bbl)}`,
          sub: `${Math.round((rolling / leased) * 100)}% of ${Math.round(leased).toLocaleString()} sf rolls by ${monthLabel(month + 12)}`,
          bbl,
          page: "leasing",
        });
      }
    }
  }
  // The facility is one balloon against many deeds — the same eighteen-month
  // horizon applies, for the same reason attention watches it at twelve.
  if (game.facility) {
    const left = game.facility.maturityM - month;
    if (left > 12 && left <= 18) {
      items.push({
        key: "watch-balloon:facility",
        cat: "capital",
        title: `Balloon on the horizon — ${game.facility.lender} facility`,
        sub: `${monthLabel(game.facility.maturityM)} · ${usd(game.facility.balance)}`,
        page: "debt",
      });
    }
  }
  // A delivery is a lease-up campaign with a start date. Three months out is
  // when the signage goes up and the broker gets briefed, not the day the
  // certificate of occupancy arrives.
  for (const [bbl, d] of Object.entries(game.developments ?? {})) {
    const left = d.deliverM - month;
    if (left >= 0 && left <= 3) {
      items.push({
        key: `deliver:${bbl}`,
        cat: "assets",
        title: `${addr(bbl)} — ${Math.round(d.sf).toLocaleString()} sf coming out of the ground`,
        sub: `delivers ${monthLabel(d.deliverM)}`,
        bbl,
      });
    }
  }

  // (c) This month's tape — the news the tick just wrote, warnings and events
  // ahead of gossip, four lines at most. The full record is on the News desk.
  const rank = (k: string) => (k === "warn" ? 0 : k === "event" ? 1 : 2);
  const tape = (game.news ?? [])
    .filter((n) => n.q === month)
    .sort((a, b) => rank(a.kind) - rank(b.kind))
    .slice(0, 4);
  const used = new Set(items.map((i) => i.key));
  tape.forEach((n, i) => {
    let key = `news:${n.q}:${n.text.replace(/\s+/g, " ").slice(0, 48)}`;
    if (used.has(key)) key = `${key}:${i}`;
    used.add(key);
    items.push({
      key,
      cat: n.kind === "deal" ? "deals" : "world",
      title: n.text,
      bbl: n.bbl,
      ...(n.bbl ? {} : { page: "news" as Page }),
    });
  });

  // Snoozes are honored before the milestone check: a quiet docket after
  // three snoozes is a quiet docket, and the nudge may take the empty seat.
  const live = items.filter((it) => !((snooze[it.key] ?? -1) > month));

  // (d) The year-one nudge — the next milestone a first-year firm has not
  // reached, offered only when nothing on the desk is on fire. netWorth is a
  // full-book appraisal walk, so it runs only inside the first twelve months.
  if (month < 12 && parcels && !live.some((it) => it.urgent)) {
    const nw = netWorth(game, parcels);
    const next = MILESTONES.find((m) => YEAR_ONE_IDS.includes(m.id) && !m.test(game, nw));
    if (next && !((snooze[`milestone:${next.id}`] ?? -1) > month)) {
      live.push({
        key: `milestone:${next.id}`,
        cat: "world",
        title: next.label,
        sub: `${12 - month} mo of year one left`,
        page: "market",
      });
    }
  }

  // Causality order: capital decides deals, deals decide assets, assets are
  // what the city sees. Stable within a category, so the engine's own order
  // (which puts the letters before the gossip) survives.
  live.sort((a, b) => CAT_ORDER[a.cat] - CAT_ORDER[b.cat]);

  if (live.length > DOCKET_CAP) {
    const folded = live.length - DOCKET_CAP;
    const shown = live.slice(0, DOCKET_CAP);
    shown.push({
      key: "docket-more",
      cat: "world",
      title: `+${folded} more on the desks`,
      more: folded,
    });
    return shown;
  }
  return live;
}
