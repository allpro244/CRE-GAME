import type { ReactNode } from "react";
import type { BridgeKey, ValueBridge as Bridge } from "@/engine/value";
import { usd, usdSigned } from "@/ui/format";
import { Row } from "@/ui/panels/shared";

/**
 * WHICH ADJUSTMENT (owner, 2026-11-27). A stabilised, fully let building
 * appraises at its in-place NOI over the market's own cap unless a named,
 * sourced adjustment explains the gap, and the screen says which. The steps
 * are the engine's own (value.ts valueBridge): each is a difference of two
 * terms of the mark, so they sum to the centre of the appraisal band shown
 * beside them. This file only words them.
 */
const CLASS_WORD: Record<string, string> = { office: "office", retail: "retail", multifamily: "apartment", industrial: "industrial" };
const pct = (x: number, d = 2) => `${(100 * x).toFixed(d)}%`;

export function bridgeLine(key: BridgeKey, br: Bridge): { label: string; tip: string } {
  const p = br.parts, i = br.info;
  switch (key) {
    case "anchor": return {
      label: `In-place NOI ${usd(p.noi)} ÷ ${CLASS_WORD[i.cls] ?? i.cls} market cap ${pct(p.capIdx)}`,
      tip: "The city's cap rate for the class: read off closed trades and the brokers' survey of what the street's buyers paid, on NOI after the owner's property tax.",
    };
    case "stabilised": return {
      label: "Stabilised value (no positive in-place NOI to capitalise)",
      tip: "Stabilised NOI at the occupancy this corner runs at, over this building's cap plus the owner's tax.",
    };
    case "buildingCap": return {
      label: `This building's cap ${pct(p.cap)} (location, condition, spec)`,
      tip: "The class cap adjusted for this building's location, condition and spec, on the same fit to closed trades.",
    };
    case "flatsRoll": {
      const f = i.flatsVsMkt ?? 0;
      return {
        label: `Flats' rents ${f >= 0 ? "+" : "−"}${Math.abs(100 * f).toFixed(1)}% vs market, re-letting over ~${Math.round(i.flatsMonths ?? 12)} months`,
        tip: "Twelve-month leases: about a twelfth of the flats re-let each month (fewer under rent stabilisation), so the gap to market lasts as long as the roll takes to turn.",
      };
    }
    case "leaseRoll": {
      const side = p.gapC >= 0 ? "above" : "below";
      // Physical occupancy on all rentable feet, the stabilised roll's own basis.
      // Not "let": that word is the lettable read (occupancyRead.lettableOcc) on
      // the Parcel desk, toast and news, which leaves out feet no suite can use.
      const occ = `${Math.round(100 * i.occ)}% of rentable feet occupied vs ${Math.round(100 * i.stabOcc)}% stabilised`;
      return i.leases > 0 ? {
        label: `Leases ${side} a stabilised roll (${occ}), until they end (WALT ${i.walt.toFixed(1)} y)`,
        tip: "The market cap is a cap on a stabilised roll at effective rent. In-place NOI over the cap would keep rent, occupancy and face rent above or below that for good; each lease's difference lasts only for its remaining term (Appraisal Institute, The Appraisal of Real Estate, ch. 22).",
      } : {
        label: `Occupancy ${side} a stabilised roll (${occ}), closing on the market's clock`,
        tip: "With no commercial lease to hold it, the gap to a stabilised roll closes at the market's pace: about a quarter a year (Wheaton & Torto).",
      };
    }
    case "vacancy": return {
      label: "Vacant space lets up on the market's clock",
      tip: "In-place NOI over the cap would hold the empty feet empty for good. They are let over the time this market takes to let space like this, and what letting them adds counts from then.",
    };
    case "firstLeaseUp": return { label: "Still in its first lease-up", tip: "As-is on completion: stabilised, less the fit-out, the income given up while it fills, and the risk it does not." };
    case "vacancyFloor": return { label: "Empty space valued as a lease-up", tip: "A building with an empty floor is valued the way a lease-up is: stabilised, less the cost and time to fill it." };
    case "freeRent": return { label: "Free rent still owed", tip: "Concessions granted and not yet burned off. A buyer credits them off the price." };
    case "landFloor": return { label: "Worth more as a cleared site", tip: "The land less the cost of clearing it is worth more than the building's income." };
    case "taxAbatement": return { label: "Tax abatement still to run", tip: "The present value of the property-tax abatement left, at the building's all-in yield." };
    case "groundRent": return { label: "Ground rent you pay", tip: "A leasehold: the freehold less the value of the ground rent." };
    case "leaving": return { label: "Tenants who served notice", tip: "Valued as the building will stand once they leave, plus the rent still owed." };
    case "rollover": return { label: "Re-letting reserve, leases ending within 12 months", tip: "Fit-out, commissions and downtime a buyer reserves for leases the renewal read says are leaving." };
    case "appraiser": return { label: "Appraiser's read of this parcel", tip: "Each parcel's appraisal carries a fixed read around the engine's value; the band shown is centred on it." };
    case "other": return { label: "Other small adjustments", tip: "Adjustments each under half a per cent of value, together." };
  }
}

/** The bridge as a fold: the summary is whatever the caller already showed (the appraisal band), the lines open under it. */
export function ValueBridgeFold({ br, summary }: { br: Bridge | null; summary: ReactNode }) {
  if (!br) return <div className="hint">{summary}</div>;
  return (
    <details className="loi-terms-fold value-bridge">
      <summary><span className="loi-terms-label">Value</span><span>{summary}</span></summary>
      <div className="grid">
        {br.steps.map((st, n) => {
          const { label, tip } = bridgeLine(st.key, br);
          return <Row key={st.key} k={label} v={n === 0 ? usd(st.v) : usdSigned(st.v)} title={tip} />;
        })}
        <Row k="Appraisal, centre of the band" v={usd(br.total)} strong />
      </div>
    </details>
  );
}

/** The bridge as one tooltip, for a tile that has no room for a fold. */
export function bridgeTitle(br: Bridge | null): string | undefined {
  if (!br) return undefined;
  return br.steps.map((st, n) => `${n === 0 ? usd(st.v) : usdSigned(st.v)}  ${bridgeLine(st.key, br).label}`).join("\n")
    + `\n= ${usd(br.total)} (centre of the band)`;
}

/**
 * The slider's own rule for a price against the appraisal's centre — below
 * 0.95 is under market, above 1.12 over it — so the cap line and the slider
 * can never disagree about the same ask.
 */
export function priceVerdict(price: number, mid: number): "below market" | "above market" | "at market" {
  return price < mid * 0.95 ? "below market" : price > mid * 1.12 ? "above market" : "at market";
}
