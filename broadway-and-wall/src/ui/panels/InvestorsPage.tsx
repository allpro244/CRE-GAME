import { FundDesk } from "@/ui/panels/FundDesk";
import { SyndicateDesk } from "@/ui/panels/SyndicateDesk";

/**
 * CAPITAL → INVESTORS. Equity, not debt: your standing with investors and
 * what it opens (SyndicateDesk), the deals you raised one at a time, and the
 * blind-pool fund once the record earns one (FundDesk). Raising for a job is
 * done on the Build desk; this is where the record and the money are read.
 */
export function InvestorsPage() {
  return (
    <>
      <SyndicateDesk />
      <FundDesk />
    </>
  );
}
