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
    def: "Your number and your patience, per asset type: the least net effective you will sign, and how long you hold it on empty space before meeting the street. Whoever holds the pen — a desk, or you clearing your own tray — asks the street or your number, keeps the tenant's package and asks for the rent that reaches it. Nobody is turned away for the shape of their deal, only for price.",
  },
  "the street": {
    def: "What deals in town are actually signing this month, as a share of asking rent — the effective/face index. Concessions widen it in a glut and close it in a squeeze.",
  },
  "clear the tray": {
    def: "Run every letter waiting on you against your own number in one pass: what nets it signs, what can be countered is countered, and the decisions that are really yours — competing tenants, expansions, the treasury — stay on your desk with the reason. You still hold the pen and pay your own 4%/2%.",
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
        // Already on the Primer (a dotted word inside it): no remount, so say so.
        window.dispatchEvent(new Event("bw:gloss"));
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

/**
 * THE GLOSSARY, WHEREVER THE WORD IS. Thirteen hand-placed <Gloss> wrappers
 * covered a game that prints DSCR, LTV, NOI and WALT on every desk. This finds
 * a defined term inside a short label — acronyms matched as written, phrases
 * in any case, whole words only — so a stat tile or a row can carry the
 * definition as its tooltip without anyone wrapping it by hand. Labels with a
 * tooltip of their own keep it.
 */
const GLOSS_ORDER = Object.keys(TERMS).sort((a, b) => b.length - a.length);
const GLOSS_RE = new Map(GLOSS_ORDER.map((k) => {
  const acronym = k === k.toUpperCase();
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [k, new RegExp(`(^|[^A-Za-z])${esc}([^A-Za-z]|$)`, acronym ? "" : "i")] as const;
}));
export function glossFor(label: unknown): string | undefined {
  if (typeof label !== "string" || label.length > 48) return undefined;
  for (const k of GLOSS_ORDER) {
    if (GLOSS_RE.get(k)!.test(label)) return `${k} — ${TERMS[k].def}`;
  }
  return undefined;
}
