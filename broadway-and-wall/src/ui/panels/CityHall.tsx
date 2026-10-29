import { useStore } from "@/state/store";
import { monthLabel, START_YEAR } from "@/engine/types";
import { PLATFORM_LABEL, PLATFORM_PARTY, revTotal, opSpend, cityDebt, type BudgetLines } from "@/engine/citygov";
import { TAX_RATE } from "@/engine/value";
import { Row } from "@/ui/panels/shared";

const M = (v: number) => `${v < 0 ? "−" : ""}$${(Math.abs(v) / 1e6).toFixed(1)}M`;
const P = (v: number, d = 2) => `${(v * 100).toFixed(d)}%`;

/**
 * CITY HALL — the government that levies the tax line on every building
 * (citygov.ts). Numbers first: the budget by line, the debt and what the
 * market charges the city for it, the policies in force, and who is mayor.
 */
export function CityHallBox({ open = false }: { open?: boolean }) {
  const game = useStore((s) => s.game)!;
  const g = game.econ.gov;
  if (!g) return null;
  // The last full fiscal year where there is one; otherwise this month, annualised.
  const fy: BudgetLines = g.lastFy ?? g.mo;
  const k = g.lastFy ? 1 : 12;
  const rev = revTotal(fy) * k, op = opSpend(fy) * k;
  const serial = (fy.principal - fy.notesRepaid) * k;
  const bal = rev - op - serial;
  const debt = cityDebt(g), notes = cityDebt(g, "note"), state = cityDebt(g, "state");
  const pol = g.policy;
  const yr = (m: number) => START_YEAR + Math.floor(m / 12);
  const fyLabel = g.lastFy ? `FY${g.lastFy.yr}` : "this month, annualised";
  return (
    <details className="page-section" style={{ marginTop: 14 }} open={open}>
      <summary style={{ cursor: "pointer" }}>
        City Hall · Mayor {g.mayor.name} ({PLATFORM_LABEL[g.mayor.platform]}) · property tax {P(pol.propRate)} · {bal >= 0 ? "surplus" : "deficit"} {M(bal)}{g.control ? " · CONTROL BOARD" : ""}
      </summary>
      <div className="grid">
        <Row k="Mayor" v={`${g.mayor.name} · ${PLATFORM_PARTY[g.mayor.platform]}`} strong title={`Elected with ${(g.mayor.share * 100).toFixed(0)}%, term ${g.mayor.terms}`} />
        <Row k="Platform" v={PLATFORM_LABEL[g.mayor.platform]} />
        <Row k="Next election" v={monthLabel(g.mayor.nextElectionM)} />
        {g.control && <Row k="State control" v={`since ${yr(g.control.sinceM)} · ${g.control.balancedYrs}/3 balanced yrs`} bad />}
      </div>
      <div className="page-section" style={{ marginTop: 10 }}>Budget · {fyLabel}</div>
      <div className="grid">
        <Row k="Revenue" v={M(rev)} strong />
        <Row k="  Property tax" v={M(fy.rev.property * k)} />
        <Row k="  Payroll tax" v={M(fy.rev.payroll * k)} />
        <Row k="  Sales tax" v={M(fy.rev.sales * k)} />
        <Row k="  Transfer tax" v={M(fy.rev.transfer * k)} />
        <Row k="  Fees" v={M(fy.rev.fees * k)} />
        <Row k="  State aid" v={M(fy.rev.aid * k)} />
        <Row k="  Interest" v={M(fy.rev.interest * k)} />
        <Row k="Spending" v={M(op + serial)} strong />
        <Row k="  Services" v={M(fy.spend.services * k)} title="Police, fire, sanitation, roads, parks" />
        <Row k="  Schools" v={M(fy.spend.schools * k)} />
        <Row k="  Pensions" v={M(fy.spend.pensions * k)} />
        <Row k="  Debt interest" v={M(fy.spend.interest * k)} />
        <Row k="  Debt principal" v={M(serial)} />
        <Row k={bal >= 0 ? "Surplus" : "Deficit"} v={`${M(bal)} (${P(bal / Math.max(1, rev), 1)})`} bad={bal < 0} strong />
        <Row k="Capital spending" v={M(fy.spend.capital * k)} title="Bond-funded: renewal and civic works" />
      </div>
      <div className="page-section" style={{ marginTop: 10 }}>Debt</div>
      <div className="grid">
        <Row k="Cash" v={M(g.cash)} bad={g.cash < 0} title={g.cash < 0 ? "Negative: bills unpaid" : undefined} />
        <Row k="Bonds outstanding" v={M(debt)} strong />
        {notes > 0 && <Row k="  Short notes" v={M(notes)} bad />}
        {state > 0 && <Row k="  State-backed" v={M(state)} />}
        <Row k="Debt / revenue" v={`${(debt / Math.max(1, g.rev12)).toFixed(2)}×`} />
        <Row k="Bond spread" v={`${g.spread.toFixed(2)} pts`} bad={g.spread > 1.5} title="Over the tax-exempt curve. Market closes near 3 pts" />
        <Row k="Market" v={g.control ? "state agency borrows" : g.open ? "open" : "closed to the city"} bad={!g.open} />
        <Row k="Pension funded" v={P(g.pension.assets / Math.max(1, g.pension.liab), 0)} bad={g.pension.assets < 0.6 * g.pension.liab}
          title={`Liability ${M(g.pension.liab)}, assets ${M(g.pension.assets)}`} />
        <Row k="Fiscal crises" v={g.crises.length ? g.crises.map((c) => yr(c.m)).join(", ") : "none"} bad={g.crises.length > 0} />
      </div>
      <div className="page-section" style={{ marginTop: 10 }}>Policy</div>
      <div className="grid">
        <Row k="Property tax" v={`${P(pol.propRate)} of value`} strong title={`Statutory ${P(TAX_RATE)}`} />
        <Row k="Payroll tax" v={P(pol.wageRate)} />
        <Row k="Sales tax, local" v={P(pol.salesRate, 1)} />
        <Row k="Transfer tax" v={P(pol.transferRate, 1)} title="Paid by the seller at closing" />
        <Row k="New-building abatement" v={pol.abate ? `${Math.round(pol.abate.pct * 100)}% for ${pol.abate.years} yrs` : "none"} />
        <Row k="Rent rules" v={pol.rentCap ? `stabilised, built by ${pol.rentCap.sinceYr}` : "none"} title={pol.rentCap ? "Renewals capped near 70% of inflation" : undefined} />
        <Row k="Service level" v={`${(pol.service * 100).toFixed(0)}% of normal`} bad={pol.service < 0.95} />
      </div>
      {g.log.length > 0 && (
        <>
          <div className="page-section" style={{ marginTop: 10 }}>Record</div>
          <div className="hint" style={{ lineHeight: 1.5 }}>
            {g.log.slice(-6).reverse().map((x, i) => <div key={i}>{monthLabel(x.m)} · {x.text}</div>)}
          </div>
        </>
      )}
    </details>
  );
}
