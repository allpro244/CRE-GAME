/**
 * Map an attentionItems key to a page / parcel / special action.
 * Lives in engine so harnesses can assert every inbox key routes somewhere.
 */
import type { GameState } from "./types";

export type AttentionPage =
  | "none" | "portfolio" | "deals" | "market" | "research" | "economy" | "books"
  | "news" | "leasing" | "debt" | "property" | "saves" | "notes" | "settings"
  | "staff" | "primer";

export type AttentionRoute = {
  page?: AttentionPage;
  bbl?: string;
  /** Open the July auction card. */
  auction?: boolean;
};

export function routeAttention(key: string, game: GameState | null): AttentionRoute {
  if (!game) return {};
  const head = key.split(":")[0];

  if (head === "loi") return { page: "deals" };
  if (head === "tenant-ask") {
    const id = Number(key.split(":")[1]);
    const ask = (game.asks ?? []).find((a) => a.id === id);
    return ask ? { page: "property", bbl: ask.bbl } : { page: "deals" };
  }
  if (head === "portfolio-bid") return { page: "portfolio" };
  if (head === "broker") {
    const bbl = key.split(":")[1];
    return { page: "market", bbl };
  }
  if (head === "early-look") {
    const bbl = key.split(":")[1];
    return { page: "market", bbl };
  }
  if (head === "offer" || head === "sale-bids") {
    const bbl = key.split(":")[1];
    return { page: "portfolio", bbl };
  }
  if (head === "nonrenew" || head === "lease-roll" || head === "capital-plan") {
    const bbl = key.split(":")[1];
    return { page: "leasing", bbl };
  }
  // Arrears and a renewed balloon are both answered on the debt desk: one
  // needs the refinance / payoff buttons, the other is the record of them.
  if (head === "balloon" || head === "sweep" || head === "arrears" || head === "renewed") {
    const bbl = key.split(":")[1];
    return { page: "debt", bbl };
  }
  // Everything the pool does lands on the same page, because there is one pool
  // and its refinance, paydown and release desks are all on it.
  if (
    head === "facility-balloon" || head === "facility-sweep" || head === "facility-arrears"
    || head === "facility-called" || head === "facility-accel" || head === "facility-renewed"
  ) return { page: "debt" };
  if (head === "capital-call") {
    const bbl = key.split(":")[1];
    return { page: "property", bbl };
  }
  if (head === "workout") {
    const bbl = key.split(":")[1];
    return { page: "property", bbl };
  }
  if (head === "contract" || head === "talks") {
    const bbl = key.split(":")[1];
    return { page: "deals", bbl };
  }
  if (head === "exchange") return { page: "portfolio" };
  if (head === "note" || head === "npl" || head === "private-ask" || head === "private-borrow") {
    return { page: "notes" };
  }
  if (head === "street-book") return { page: "market" };
  if (head === "auction") return { page: "market", auction: true };
  if (head === "line-over" || head === "cash-runway") return { page: "debt" };
  if (head === "cash") return { page: "books" };
  if (head === "ti-book") return { page: "leasing" };
  if (head === "estate") return { page: "property" };
  if (head === "over") return { page: "saves" };
  return { page: "deals" };
}
