import { FundDesk } from "@/ui/panels/FundDesk";
import { SyndicateDesk } from "@/ui/panels/SyndicateDesk";

/**
 * CAPITAL → INVESTORS. Equity, not debt: your standing with investors and
 * what it opens (SyndicateDesk), and the fund (FundDesk) — raised once from
 * whoever your record opens, and spent on land, buildings or development.
 * Deals are no longer syndicated one by one.
 */
export function InvestorsPage() {
  return (
    <>
      <SyndicateDesk />
      <FundDesk />
    </>
  );
}
