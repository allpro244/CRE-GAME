import type { ReactNode } from "react";
import { useStore } from "@/state/store";

/**
 * Inline CRE literacy — hover for a short definition, click to open Primer.
 * Does not change any game numbers.
 */
const TERMS: Record<string, { def: string; primerHint?: string }> = {
  NOI: {
    def: "Net operating income — rent collected minus operating costs. Does not subtract the mortgage.",
  },
  "cap rate": {
    def: "Capitalisation rate — one year's NOI divided by price. A low cap means an expensive building.",
  },
  DSCR: {
    def: "Debt service coverage ratio — NOI ÷ annual debt service. Lenders usually want ≥1.25×.",
  },
  LTV: {
    def: "Loan-to-value — loan balance ÷ appraisal. Coverage often binds before leverage does.",
  },
  WALT: {
    def: "Weighted average lease term — how long the rent roll has left, weighted by rent.",
  },
  NNN: {
    def: "Triple-net lease — tenant reimburses taxes, insurance and operating expenses.",
  },
  TI: {
    def: "Tenant improvement allowance — cash you spend to fit out space for a new lease.",
  },
  IO: {
    def: "Interest-only period — you pay coupon but not principal until amortisation starts.",
  },
  "going-in cap": {
    def: "In-place NOI ÷ purchase price — the yield you buy at before lease-up or growth.",
  },
  "negative leverage": {
    def: "When the loan coupon exceeds the cap rate you buy at — debt compresses equity returns.",
  },
  balloon: {
    def: "Principal due at maturity. Must be refinanced or repaid — the classic cycle risk.",
  },
  FAR: {
    def: "Floor area ratio — max buildable floor space as a multiple of lot area.",
  },
  variance: {
    def: "Permission to build past the zoning envelope on one lot, argued at a hearing months after you file. The fee is sunk either way; the extra FAR is yours only if they grant it.",
  },
  upzoning: {
    def: "The city raising a district's allowed density — every lot under the new envelope reprices at once. A downzoning is the same walk in reverse, taken out of land you may already own.",
  },
  "first look": {
    def: "A broker showing you a mandate weeks before it reaches the open tape, earned by closing their deals. Let enough of these windows lapse and the shop stops calling.",
  },
  coterminous: {
    def: "A lease written to end the same month as one the tenant already holds. Expansions are signed this way — one covenant, one roll date, one negotiation at the end.",
  },
  spinout: {
    def: "A senior hire leaving an established shop to raise their own vehicle. The new firm starts small and knows its old employer's book — sometimes yours too.",
  },
  suite: {
    def: "A tenancy cut from a floorplate — the size the tenant asked for, not a pre-cut equal bite. A remnant under the lettable floor is not a suite.",
  },
  demise: {
    def: "The event of cutting (or merging) space to fit a tenant. A cut costs real capex; taking a wall down when a neighbour leaves costs the same per foot.",
  },
  floorplate: {
    def: "One floor of one use — the physical inventory. A building is a stack of plates; vacant space is contiguous blocks, not N equal suites.",
  },
  remnant: {
    def: "A leftover bite of a plate too small for a standard suite. Priced at a discount; often a must-take for the sitting neighbour, because nobody else can lease it.",
  },
  "stabilised pro-forma": {
    def: "What the building would earn full at market rent and normal vacancy — the income after lease-up, not the income you buy.",
  },
  "net effective": {
    def: "The rent a lease is really worth once free months and the fit-out you pay for are spread over its term — below the face rent it quotes.",
  },
  "letter of intent": {
    def: "A tenant's written offer on size, term, rent, free months and fit-out. Not yet a lease: sign it and the lease follows; counter and they may walk.",
  },
  "earnest money": {
    def: "The deposit that goes hard when a price is agreed. Fail to close in time and the seller keeps it.",
  },
  "cash-on-cash": {
    def: "A year's cash after debt service ÷ the equity you put in — the return on your own money, before any gain on sale.",
  },
  "debt yield": {
    def: "NOI ÷ loan amount. A lender's floor that ignores the rate: at 8% a lender is paid back from income alone in twelve and a half years.",
  },
  "leasing plan": {
    def: "The posted asking sheet the desk and you both clear against — quote, hold-out, package, dollar authority. Not four mandate bands.",
  },
};

export function Gloss({
  term,
  children,
}: {
  term: keyof typeof TERMS | string;
  children?: ReactNode;
}) {
  const setPage = useStore((s) => s.setPage);
  const entry = TERMS[term] ?? TERMS[term.toLowerCase()];
  if (!entry) return <>{children ?? term}</>;
  return (
    <button
      type="button"
      className="gloss"
      title={entry.def}
      onClick={(e) => {
        e.stopPropagation();
        // Land on the word, not the top of the Primer.
        pendingTerm.key = TERMS[term] ? term : term.toLowerCase();
        setPage("primer");
      }}
    >
      {children ?? term}
    </button>
  );
}


/** The term a click asked for; the Primer scrolls to it once and clears it. */
export const pendingTerm: { key: string | null } = { key: null };
export const glossId = (k: string) => "gloss-" + k.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** Every term, for the Primer's full glossary. */
export function glossaryEntries(): { key: string; def: string }[] {
  return Object.entries(TERMS).map(([key, v]) => ({ key, def: v.def }))
    .sort((a, b) => a.key.localeCompare(b.key, undefined, { sensitivity: "base" }));
}
