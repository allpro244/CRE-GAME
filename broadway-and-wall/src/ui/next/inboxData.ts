/**
 * THE INBOX, BUILT (BUILD_SPEC 3.1-3.2).
 *
 * Source: `attentionItems` — every decision the docket, the at-risk banner and
 * the decision cards read. Each row is a subject and a fact fragment (numbers
 * first, at most 8 words), and the verbs that answer it, each one an existing
 * store action. None of the docket's coaching rows come across (R6). Sweeps
 * and self-renewing balloons fold, as the docket folds them.
 */
import type { GameState } from "@/engine/types";
import type { ParcelTable } from "@/data/types";
import { monthLabel } from "@/engine/types";
import { attentionItems, type AttentionItem } from "@/engine/sim";
import { loanLender } from "@/engine/debt";
import { loiSigningCost } from "@/engine/leasing";
import { loiMarketPsf } from "@/ui/panels/LoiNegotiate";
import { routeAttention } from "@/ui/attentionRoute";
import { useStore } from "@/state/store";
import { usd, pct, sf } from "@/ui/format";
import { useNext } from "./nextStore";
import { assertWords, clipWords } from "./words";
import type { Verb } from "./Drawer";

export type Sev = "critical" | "decide" | "info";
export interface InboxVerb extends Verb {
  /** Asks for a number first; `run` is then unused. */
  amount?: { initial: number; go: (n: number) => void };
  /** Asks "Sure?" inline before running. */
  confirm?: boolean;
}
export interface InboxItem {
  key: string;
  sev: Sev;
  subject: string;
  facts: string;
  verbs: InboxVerb[];
  bbl?: string;
  dueM?: number;
  /** Not snoozable: critical items and anything urgent. */
  pinned?: boolean;
}

const S = () => useStore.getState();
const mo = (m: number) => monthLabel(m).replace(/^(\w{3})\w*\s(\d{4})$/, "$1 $2");

function done(item: { key: string; subject: string; facts: string }, verb: string) {
  useNext.getState().markDone({ ...item, verb, m: S().game?.month ?? 0 });
}

/** Wraps a verb so answering it files the row under Done. */
function answer(it: { key: string; subject: string; facts: string }, v: InboxVerb): InboxVerb {
  const run = v.run;
  const amt = v.amount;
  return {
    ...v,
    run: () => { run(); done(it, v.label); },
    ...(amt ? { amount: { initial: amt.initial, go: (n: number) => { amt.go(n); done(it, `${v.label} ${usd(n)}`); } } } : {}),
  };
}

function openVerb(key: string): InboxVerb {
  return { label: "Open", run: () => S().openAttention(key) };
}

function build(g: GameState, p: ParcelTable | null, a: AttentionItem): Omit<InboxItem, "sev"> & { real: boolean } {
  const addr = (bbl: string) => p?.[bbl]?.address ?? bbl;
  const parts = a.key.split(":");
  const head = parts[0];
  const route = routeAttention(a.key, g);
  const base = { key: a.key, bbl: route.bbl ?? undefined, dueM: a.lastM };
  const fallback = {
    ...base,
    subject: route.bbl ? addr(route.bbl) : "Firm",
    facts: clipWords(a.label.replace(/^[^:—]+[:—]\s*/, ""), 8),
    verbs: [openVerb(a.key)],
    real: false,
  };
  switch (head) {
    case "loi": {
      const id = Number(parts[1]);
      const l = g.lois.find((x) => x.id === id);
      if (!l) return fallback;
      const mkt = p ? loiMarketPsf(g, p, l) : 0;
      const vs = mkt > 0 ? ` · ${l.rentPsf >= mkt ? "+" : "−"}${Math.abs(Math.round((l.rentPsf / mkt - 1) * 100))}%` : "";
      return {
        ...base, bbl: l.bbl, dueM: l.expiresM - 1, real: true,
        subject: l.name,
        facts: `${l.kind === "new" ? "" : l.kind + " · "}${sf(l.sf)} · ${Math.round(l.termM / 12)}y · $${l.rentPsf.toFixed(2)}${vs} · ${usd(loiSigningCost(l))}`,
        verbs: [
          { label: "Sign", primary: true, run: () => { S().respondLoi(id, "accept"); } },
          { label: "Counter", run: () => { S().setLoiFocus(id); S().openProperty(l.bbl, "leasing"); } },
          { label: "Decline", run: () => { S().respondLoi(id, "decline"); } },
        ],
      };
    }
    case "tenant-ask": {
      const id = Number(parts[1]);
      const t = (g.asks ?? []).find((x) => x.id === id);
      if (!t) return fallback;
      return {
        ...base, bbl: t.bbl, dueM: t.expiresM - 1, real: true,
        subject: t.name,
        facts: t.kind === "giveback"
          ? `Give back ${sf(t.giveSf ?? t.sf)} · by ${mo(t.expiresM - 1)}`
          : `$${t.currentPsf.toFixed(2)} → $${t.askPsf.toFixed(2)} · ${sf(t.sf)} · by ${mo(t.expiresM - 1)}`,
        verbs: [
          { label: "Grant", primary: true, run: () => S().answerAsk(id, "grant") },
          { label: "Decline", run: () => S().answerAsk(id, "decline") },
        ],
      };
    }
    case "offer": {
      const bbl = parts[1];
      const o = g.holdings[bbl]?.sale?.offer;
      if (!o) return fallback;
      return {
        ...base, bbl, dueM: o.expiresM, real: true,
        subject: addr(bbl),
        facts: `Offer ${usd(o.price)} · until ${mo(o.expiresM)}`,
        verbs: [
          { label: "Take", primary: true, confirm: true, run: () => S().acceptOffer(bbl) },
          { label: "Counter", run: () => {}, amount: { initial: Math.round(o.price * 1.05), go: (n) => S().counterSale(bbl, n) } },
          { label: "Decline", run: () => S().declineOffer(bbl) },
        ],
      };
    }
    case "sale-bids": {
      const bbl = parts[1];
      const bids = (g.holdings[bbl]?.sale?.bids ?? []).filter((b) => !b.dropped);
      if (!bids.length) return fallback;
      return {
        ...base, bbl, real: true,
        subject: addr(bbl),
        facts: `${bids.length} bid${bids.length === 1 ? "" : "s"} · best ${usd(bids[0].price)} · ${bids[0].name}`,
        verbs: [
          { label: "Take best", primary: true, confirm: true, run: () => S().takeBid(bbl, 0) },
          { label: "Best & final", run: () => S().runBestAndFinal(bbl) },
          openVerb(a.key),
        ],
      };
    }
    case "portfolio-bid": {
      const price = Number(parts[parts.length - 1]);
      return {
        ...base, real: true,
        subject: parts.slice(1, -1).join(":"),
        facts: `Portfolio bid ${usd(price)}`,
        verbs: [
          { label: "Take", primary: true, confirm: true, run: () => S().acceptPortfolio() },
          { label: "Counter", run: () => {}, amount: { initial: Math.round(price * 1.05), go: (n) => S().counterPortfolioBid(n) } },
        ],
      };
    }
    case "balloon": {
      const bbl = parts[1];
      const ln = g.holdings[bbl]?.loan;
      if (!ln) return fallback;
      const tag = parts[3] === "rolls" ? "renews" : parts[3] === "jump" ? "rate jump" : "gap";
      return {
        ...base, bbl, dueM: ln.maturityM, real: true,
        subject: addr(bbl),
        facts: `Balloon ${mo(ln.maturityM)} · ${usd(ln.balance)} · ${pct(ln.ratePct)} · ${tag}`,
        verbs: [{ label: "Refinance", primary: true, run: () => S().openProperty(bbl, "money") }],
      };
    }
    case "arrears":
    case "workout": {
      const bbl = parts[1];
      const h = g.holdings[bbl];
      const w = g.workouts?.[bbl];
      const facts = head === "arrears"
        ? `${parts[2]} missed · ${h?.loan ? loanLender(h.loan) : ""} · files at 3`
        : `${w?.stage ?? parts[2]} · ${w?.lender ?? ""} · ${w ? mo(w.saleM ?? w.decideM) : ""}`;
      return {
        ...base, bbl, real: true,
        subject: addr(bbl),
        facts,
        verbs: [
          { label: "Cure", primary: true, run: () => S().cureDefault(bbl) },
          { label: "Forbear", run: () => S().askForbearance(bbl) },
          { label: "Hand back", danger: true, confirm: true, run: () => S().handBackKeys(bbl) },
        ],
      };
    }
    case "private-ask": {
      const id = parts.slice(1).join(":");
      const x = (g.privateAsks ?? []).find((q) => q.id === id);
      if (!x) return fallback;
      return {
        ...base, bbl: x.bbl, dueM: x.expiresM, real: true,
        subject: x.rivalName,
        facts: `${usd(x.face)} · ${x.ratePct.toFixed(1)}% · ${Math.round(x.ltv * 100)}% LTV · ${x.address}`,
        verbs: [
          { label: "Fund", primary: true, confirm: true, run: () => S().fundPrivateAsk(id) },
          { label: "Decline", run: () => S().declinePrivateAsk(id) },
        ],
      };
    }
    case "note": {
      const id = parts.slice(1).join(":");
      const o = (g.noteOffers ?? []).find((q) => q.id === id);
      if (!o) return fallback;
      return {
        ...base, bbl: o.bbl, dueM: o.expiresM - 1, real: true,
        subject: o.address,
        facts: `${usd(o.face)} · ${Math.round(o.askPct * 100)}¢ · ${o.perf === "nonperforming" ? "NPL" : "paying"} · ${o.lender}`,
        verbs: [{ label: "Buy", primary: true, confirm: true, run: () => S().takeNote(id) }, openVerb(a.key)],
      };
    }
    case "npl": {
      const id = parts[1];
      const n = (g.notes ?? []).find((q) => q.id === id);
      return {
        ...base, real: true,
        subject: n?.address ?? "Note",
        facts: n ? `Stopped paying · ${n.obligor}` : "Stopped paying",
        verbs: [
          { label: "Restructure", primary: true, run: () => S().restructureNote(id) },
          { label: "File", run: () => S().fileNote(id) },
          { label: "Sell", run: () => S().offloadNote(id) },
        ],
      };
    }
    case "private-borrow": {
      const id = parts.slice(1).join(":");
      const q = (g.privateBorrowQuotes ?? []).find((x) => x.id === id);
      if (!q) return fallback;
      return {
        ...base, bbl: q.bbl, real: true,
        subject: q.address,
        facts: `${usd(q.principal)} · ${q.ratePct.toFixed(1)}% · ${q.lenderName}`,
        verbs: [
          { label: "Accept", primary: true, confirm: true, run: () => S().acceptPrivateBorrowQuote(id) },
          { label: "Decline", run: () => S().declinePrivateBorrowQuote(id) },
        ],
      };
    }
    case "street-book": {
      const id = parts.slice(1).join(":");
      const b = (g.portfolios ?? []).find((x) => x.id === id);
      if (!b) return fallback;
      const disc = b.gross > 0 ? Math.round((1 - b.ask / b.gross) * 100) : 0;
      return {
        ...base, dueM: b.expiresM, real: true,
        subject: b.sellerLender ?? "Book for sale",
        facts: `${b.bbls.length} deeds · ${usd(b.ask)} · ${disc}% off`,
        verbs: [
          { label: "Buy", primary: true, confirm: true, run: () => S().buyStreetBook(id) },
          { label: "Offer", run: () => {}, amount: { initial: Math.round(b.ask * 0.92), go: (n) => S().offerStreetBook(id, n) } },
        ],
      };
    }
    case "broker": {
      const bbl = parts[1];
      const ap = g.approaches[bbl];
      if (!ap?.ask) return fallback;
      return {
        ...base, bbl, real: true,
        subject: addr(bbl),
        facts: `Off-market ${usd(ap.ask)} · lapses ${mo(a.lastM ?? g.month)}`,
        verbs: [
          { label: "Counter", primary: true, run: () => {}, amount: { initial: Math.round(ap.ask * 0.95), go: (n) => S().counterOff(bbl, n) } },
          { label: "Hang up", run: () => S().hangUpCall(bbl) },
          openVerb(a.key),
        ],
      };
    }
    case "early-look":
    case "watch":
    case "reo": {
      const bbl = parts[1];
      const li = g.listings.find((x) => x.bbl === bbl);
      if (!li) return fallback;
      const tag = head === "early-look" ? "First look" : head === "reo" ? "Bank-owned" : "Watched";
      const until = head === "early-look" && li.earlyUntilM !== undefined ? ` · lapses ${mo(li.earlyUntilM - 1)}` : "";
      return {
        ...base, bbl, real: true,
        subject: addr(bbl),
        facts: `${tag} · ${usd(li.ask)}${until}`,
        verbs: [
          { label: "Pay ask", primary: true, run: () => { S().select(bbl); S().offer(bbl, li.ask, false); } },
          { label: "File", run: () => S().select(bbl) },
        ],
      };
    }
    case "contract":
    case "talks": {
      const bbl = parts[1];
      const t = g.talks?.[bbl];
      if (!t) return fallback;
      if (t.agreed) {
        return {
          ...base, bbl, real: true, dueM: (t.closeByM ?? g.month + 1) - 1,
          subject: addr(bbl),
          facts: `Contract ${usd(t.agreedPrice ?? t.theirPrice)} · fund by ${mo((t.closeByM ?? g.month + 1) - 1)}`,
          verbs: [
            { label: "Fund", primary: true, run: () => S().openProperty(bbl, "summary") },
            { label: "Walk", danger: true, confirm: true, run: () => S().walkAway(bbl) },
          ],
        };
      }
      return {
        ...base, bbl, real: true,
        subject: addr(bbl),
        facts: `Seller at ${usd(t.theirPrice)}${t.final ? " · final" : ""} · you ${usd(t.yourPrice)}`,
        verbs: [
          { label: `Take`, primary: true, run: () => S().acceptCounter(bbl) },
          { label: "Walk", run: () => S().walkAway(bbl) },
        ],
      };
    }
    case "lease-roll":
    case "nonrenew": {
      const bbl = parts[1];
      const name = parts[2];
      const t = g.holdings[bbl]?.tenants.find((x) => x.name === name);
      return {
        ...base, bbl,
        real: false,
        subject: name,
        facts: t
          ? `${head === "nonrenew" ? "Leaving" : "Expires"} ${mo(t.endM)} · ${sf(t.sf)} · $${t.rentPsf.toFixed(2)}`
          : clipWords(a.label, 8),
        verbs: [{ label: "Rent roll", run: () => S().openProperty(bbl, "leasing") }],
      };
    }
    case "capital-call": {
      const bbl = parts[1];
      const d = g.developments[bbl];
      return {
        ...base, bbl, real: false,
        subject: addr(bbl),
        facts: `Capital call · ${usd(d?.lastCapitalCall ?? 0)}`,
        verbs: [{ label: "Job file", run: () => S().openProperty(bbl, "build") }],
      };
    }
    case "auction": {
      const lots = g.auction?.lots.length ?? 0;
      return {
        ...base, real: true,
        subject: "Foreclosure auction",
        facts: `${lots} lots · hammer ${mo(Number(parts[1]))}`,
        verbs: [{ label: "Bid", primary: true, run: () => S().setAuctionOpen(true) }],
      };
    }
    default:
      return fallback;
  }
}

const SEV_ORDER: Record<Sev, number> = { critical: 0, decide: 1, info: 2 };

/** Every row, with snoozed ones flagged. Sort: critical, then due, then decide, then info. */
export function buildInbox(g: GameState, parcels: ParcelTable | null): InboxItem[] {
  const items: InboxItem[] = [];
  const sweeps: string[] = [];
  const rolls: { bbl: string; key: string }[] = [];
  for (const a of attentionItems(g, parcels)) {
    const head = a.key.split(":")[0];
    if (head === "sweep") { sweeps.push(a.key.split(":")[1]); continue; }
    if (head === "balloon" && a.key.endsWith(":rolls")) { rolls.push({ bbl: a.key.split(":")[1], key: a.key }); continue; }
    const b = build(g, parcels, a);
    const sev: Sev = a.critical ? "critical" : b.real ? "decide" : "info";
    const it: InboxItem = { key: b.key, sev, subject: b.subject, facts: assertWords(b.facts, 8, b.key), bbl: b.bbl, dueM: b.dueM, verbs: [], pinned: !!a.critical };
    it.verbs = b.verbs.map((v) => answer(it, v));
    items.push(it);
  }
  if (sweeps.length) {
    const key = `sweep-fold:${sweeps.sort().join(",")}`;
    items.push({ key, sev: "critical", pinned: true, subject: "Covenant sweep", facts: `${sweeps.length} deed${sweeps.length === 1 ? "" : "s"} · cash to lenders`, verbs: [{ label: "Loans", run: () => S().setPage("debt", "Loan by loan") }] });
  }
  for (const r of rolls) {
    const ln = g.holdings[r.bbl]?.loan;
    const it: InboxItem = {
      key: r.key, sev: "info", bbl: r.bbl, dueM: ln?.maturityM,
      subject: parcels?.[r.bbl]?.address ?? r.bbl,
      facts: ln ? `Renews ${mo(ln.maturityM)} · ${usd(ln.balance)} · ${pct(ln.ratePct)}` : "Renews",
      verbs: [],
    };
    it.verbs = [answer(it, { label: "Refinance", run: () => S().openProperty(r.bbl, "money") })];
    items.push(it);
  }
  return items.sort((x, y) => SEV_ORDER[x.sev] - SEV_ORDER[y.sev] || (x.dueM ?? 1e9) - (y.dueM ?? 1e9));
}

/** "Later" = back in three months; for a letter it also stops it halting the clock again. */
export function snooze(it: InboxItem) {
  const st = S();
  const g = st.game;
  if (!g || it.pinned) return;
  st.snoozeDocket(it.key, g.month + 3);
  if (it.key.startsWith("loi:")) st.markCardSeen(it.key);
}
