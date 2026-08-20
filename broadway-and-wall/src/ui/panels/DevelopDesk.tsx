// Ground-up development and adaptive reuse desks.
// Extracted from ParcelDesk. Three tabs: Programme · Design · Financing,
// with an always-visible summary strip so the equity cheque never hides under dials.
import { useState } from "react";
import Slider from "@/ui/Slider";
import { useStore } from "@/state/store";
import { useHeldGame } from "@/ui/heldGame";
import { monthLabel, CREDIT_LABEL } from "@/engine/types";
import type { BuiltClass, Contract, DevUse } from "@/engine/types";
import { resolveRec, physicalMaxFloors, REF_PLATE_SF } from "@/engine/value";
import {
  adaptiveReuseEligibility, planAdaptiveReuse, planDevelopment, constructionQuotes,
  farMaxFor, maxFloorsFor, maxRetailShare, retailWantsMixed, unitRange, suiteSfForUnits,
  SUITE_BOUNDS, specCostMult, FLOOR_HEIGHT_FT, MAX_SLENDERNESS, MAX_FLOORS_BY_USE,
} from "@/engine/dev";
import { blockReport } from "@/engine/demand";
import { lenderBlurb, CONSTRUCTION_LENDER } from "@/engine/lenders";
import { spendable } from "@/engine/credit";
import { USE_WORD } from "@/engine/mix";
import { usd, sf, pct } from "@/ui/format";
import { useLabel, devUseLabel, Row, LocSplitHint } from "@/ui/panels/shared";

/**
 * WHAT THE STACK BECOMES when the shops run into the two-storey cap.
 *
 * The planner has always done this to the programme: retail past two floor
 * plates goes to the uses that can carry height, because a developer who
 * cannot put shops on the ninth floor puts offices there — they do not shrink
 * the building. The dial did not know that, and the gap between the two was
 * the bug. Measured on the lot that produced the complaint, 4,218 sf at 22.5
 * FAR: twenty-five storeys with the shops dial at 95% read 88,730 sf of
 * retail off the slider, and the job it described broke ground as 7,472 sf of
 * shops under an office tower. The overflow now lands where the planner puts
 * it, in front of the player, while there is still a decision to take.
 */
export type Stack = { retail: number; office: number; multifamily: number };
export function capStack(p: Stack, retailMaxPct: number): Stack {
  if (p.retail <= retailMaxPct) return p;
  const rest = p.office + p.multifamily;
  const office = rest > 0
    ? Math.round((p.office * (100 - retailMaxPct)) / rest)
    : Math.round((100 - retailMaxPct) / 2);
  return { retail: retailMaxPct, office, multifamily: 100 - retailMaxPct - office };
}

/**
 * WHAT A FLOOR THIS SIZE IS FOR, AND WHO WILL TAKE IT.
 *
 * The desk knew the plate — the footprint slider has printed it for as long as
 * it has existed — and said nothing about whether anybody leases one. Measured
 * on a generated island: at the standard 60% dial the median lot yields a
 * 2,800 ft² plate and 0.5% of lots reach 8,000; NOT ONE lot in the city reaches
 * 15,000 without assembling. So a player dialling a "large office building" is
 * being handed a floor a third the size of the smallest boutique floor anybody
 * markets, and the only signal was that the tower looked like a mast.
 *
 * The bands are the leasing market's, not a balance decision: 15,000-25,000 ft²
 * is the workhorse full-floor range in a modern office tower, 8,000-10,000 is a
 * boutique floor, and under about 5,000 a floor is one small tenant with the
 * core taking most of it. A flat does not care — it wants a window, and the
 * sliver apartment house is a real and common building — and a shed wants clear
 * span, which is a different quantity again.
 *
 * NOTHING IS CAPPED HERE. The player can build it; the desk says what it is.
 */
export function plateVerdict(plateSf: number, use: DevUse): { word: string; note: string; bad: boolean } {
  if (use === "industrial") {
    return plateSf >= 40000
      ? { word: "clear-span shed", note: "Big enough to rack and turn a lorry in.", bad: false }
      : { word: "small shed", note: "Modern distribution wants 40,000 ft² and up on one level — this lets to trade and storage, not to logistics.", bad: false };
  }
  if (use === "retail") {
    return { word: "shopfront", note: "Shops are bought on frontage and footfall, not on plate.", bad: false };
  }
  if (use === "multifamily") {
    return plateSf >= 6000
      ? { word: "a full floor of flats", note: "Eight to twelve homes a floor off one core.", bad: false }
      : { word: "a sliver house", note: "Two or three flats a floor. Perfectly lettable — a flat wants a window, not a big plate — but the core is expensive per home.", bad: false };
  }
  // office, and the mixed programme whose swing leg is office
  if (plateSf >= 15000) return { word: "a workhorse floor", note: "15,000-25,000 ft² is what a full-floor covenant tenant takes.", bad: false };
  if (plateSf >= 8000) return { word: "a boutique floor", note: "Lets to one good tenant a floor. Below the range a corporate occupier shortlists.", bad: false };
  if (plateSf >= 5000) return { word: "under a boutique floor", note: "Boutique floors bottom out near 8,000 ft². This lets to small tenants, several to a floor, at small-tenant rents.", bad: true };
  return { word: "not a leasable office floor", note: "Under 5,000 ft² the core, the stairs and the risers take most of the plate. Offices this size let to one small firm at a time. More land, not more storeys, is what fixes it.", bad: true };
}

type BuildTab = "programme" | "design" | "financing";

const BUILD_TABS: { id: BuildTab; label: string }[] = [
  { id: "programme", label: "Programme" },
  { id: "design", label: "Design" },
  { id: "financing", label: "Financing" },
];

export function ReuseSection({ bbl }: { bbl: string }) {
  const game = useHeldGame(bbl);
  const parcels = useStore((s) => s.parcels)!;
  const rec = resolveRec(parcels, game, bbl);
  const [target, setTarget] = useState<"multifamily" | "mixed">("multifamily");
  if (!rec) return null;
  const eligibility = adaptiveReuseEligibility(game, parcels, bbl);
  const mixed = target === "mixed"
    ? { multifamily: 0.70, office: 0.20, retail: 0.10 }
    : undefined;
  const plan = eligibility.ok ? planAdaptiveReuse(game, parcels, bbl, target, mixed) : null;
  const equity = (plan?.equity ?? 0) + (plan?.pointsCost ?? 0);
  return (
    <div className="deal">
      <div className="deal-head">Adaptive reuse</div>
      <div className="hint">
        Keep the shell and convert the interior. The old building comes out of its space market when work starts;
        the new housing arrives only at delivery. Opportunity cost includes the income building you give up.
      </div>
      <div className="btn-row">
        <button className={"btn" + (target === "multifamily" ? " btn-on" : "")}
          onClick={() => setTarget("multifamily")}>Apartments</button>
        <button className={"btn" + (target === "mixed" ? " btn-on" : "")}
          onClick={() => setTarget("mixed")}>Mixed · 70% housing</button>
      </div>
      {!eligibility.ok ? (
        <div className="hint alarm">{eligibility.why}</div>
      ) : plan ? (
        <>
          <div className="grid">
            <Row k="Existing shell" v={`${sf(rec.bldgArea)} · ${rec.floors} floors · ${useLabel(rec)}`} />
            <Row k="After conversion" v={`${sf(plan.sf)} · ${target}`} strong />
            <Row k="Conversion budget" v={usd(plan.costTotal)} />
            <Row k="Opportunity cost in basis" v={usd(plan.landBasis)} />
            <Row k="Equity required" v={usd(equity)} strong bad={equity > spendable(game, parcels).total} />
            <Row k="Delivery" v={`${plan.months} months`} />
            <Row k="Yield / hurdle" v={`${plan.yieldOnCost.toFixed(2)}% / ${plan.requiredYield.toFixed(2)}%`}
              strong bad={plan.hurdleRatio < 1} />
          </div>
          <LocSplitHint need={equity} game={game} parcels={parcels} />
          <button className="btn btn-buy"
            disabled={plan.hurdleRatio < 1 || equity > spendable(game, parcels).total}
            onClick={() => useStore.getState().convertUse(bbl, target, mixed)}>
            Convert to {target === "multifamily" ? "apartments" : "mixed use"} · {usd(equity)}
          </button>
        </>
      ) : (
        <div className="hint">This shell cannot carry the target programme.</div>
      )}
    </div>
  );
}

export function DevelopSection({ bbl }: { bbl: string }) {
  const game = useHeldGame(bbl);
  const parcels = useStore((s) => s.parcels)!;
  // The LIVE record: an upzoning, a variance you won, or lots you folded
  // together all change the envelope, and planning against the static table
  // meant none of them bought you anything at this desk.
  const rec = resolveRec(parcels, game, bbl) ?? parcels[bbl];
  const [tab, setTab] = useState<BuildTab>("programme");
  const [use, setUse] = useState<DevUse>("office");
  const [cov, setCov] = useState(0.6);
  const [floors, setFloors] = useState(8);
  const [contract, setContract] = useState<Contract>("gmp");
  const [ltcWant, setLtcWant] = useState(1);   // share of the lender's max you take
  const [bank, setBank] = useState<string>(CONSTRUCTION_LENDER);   // who writes the construction loan
  const [spec, setSpec] = useState(0.5);
  // THE STACK IS YOURS TO CHOOSE. "Mixed-use" was one canonical 15/45/40
  // building, which is a preset rather than a programme — how much retail the
  // frontage carries and whether the middle is offices or flats is the biggest
  // decision on the site, and it drives cost, exit cap and lender appetite.
  const [split, setSplit] = useState<{ retail: number; office: number; multifamily: number }>(
    { retail: 15, office: 45, multifamily: 40 },
  );
  // ...and so is how it is cut up. `null` means the class default.
  const [units, setUnits] = useState<Partial<Record<BuiltClass, number>>>({});
  const maxFl = maxFloorsFor(rec, cov, use);
  const fl = Math.min(floors, maxFl);
  // SHOPS DO NOT STACK, AND THE DIAL NOW SAYS SO. Two floor plates is the
  // whole retail allowance, so the ceiling on the shops dial falls as the
  // storeys rise — a quarter of an eight storey building, eight per cent of a
  // twenty-five storey one — and the stack the planner reads is the stack on
  // the screen. The dial used to run to 100% at any height and report the
  // whole building as shops; the planner redistributed it regardless, so the
  // design the player was reading was one no job could ever be.
  const retailPctMax = Math.max(0, Math.floor(maxRetailShare(fl) * 100));
  const stack = capStack(split, retailPctMax);
  const customMix = use === "mixed"
    ? { retail: stack.retail / 100, office: stack.office / 100, multifamily: stack.multifamily / 100 }
    : undefined;
  const bts = game.btsProspects?.[bbl]?.use === use ? game.btsProspects[bbl] : undefined;
  const btsOffer = game.holdings[bbl]?.btsOffer;
  const planMax = planDevelopment(game, parcels, bbl, use, fl, cov, contract, undefined, { mix: customMix, bts }, bank, spec);
  // Turn the chosen unit counts into sf-per-space, against the programme that
  // is actually going to be built.
  const suiteChoice: Partial<Record<BuiltClass, number>> = {};
  if (planMax) {
    for (const u of Object.keys(planMax.mix) as BuiltClass[]) {
      const n = units[u];
      if (!n) continue;
      suiteChoice[u] = suiteSfForUnits(planMax.sf * (planMax.mix[u] ?? 0), u, n);
    }
  }
  const plan = planDevelopment(game, parcels, bbl, use, fl, cov, contract,
    planMax ? planMax.ltcMax * ltcWant : undefined, { mix: customMix, suites: suiteChoice, bts }, bank, spec);
  const nb = blockReport(game, parcels, rec.block);
  // ONE NUMBER, WHEREVER IT IS ASKED FOR. The equity figure on the dials and
  // the equity figure on the groundbreak button are the same decision — what
  // this design costs you in your own money, all in — and two call sites that
  // happen to read the same field are one edit away from disagreeing, which
  // is exactly what this card was accused of. Every equity read below goes
  // through these two: the whole cheque, and whether you can write it.
  const equityRequired = (plan?.equity ?? 0) + (plan?.pointsCost ?? 0);   // origination is cash at close, so it belongs on the cheque
  const canFund = equityRequired <= spendable(game, parcels).total;
  const closeCheque = plan ? plan.equityAtClose + plan.pointsCost : 0;
  const USES: DevUse[] = ["office", "multifamily", "mixed", "retail", "industrial"];

  return (
    <div className="deal">
      <div className="deal-head">Develop this lot</div>
      <div className="hint">
        {sf(rec.lotArea)} of land · envelope {farMaxFor(rec).toFixed(1)} FAR · anything may be built here.
      </div>

      {/* ALWAYS-VISIBLE SUMMARY — the cheque never lives under a tab. */}
      {plan && (
        <div className="grid" style={{ margin: "6px 0 8px" }}>
          <Row
            k="Equity at closing"
            v={`${usd(closeCheque)} due the day you break ground`}
            strong
            bad={closeCheque > spendable(game, parcels).total}
            title="The bank will not fund until this leaves your account, plus the origination fee. The line counts."
          />
          <Row
            k="Equity all-in"
            v={`${usd(equityRequired)} total · ${usd(plan.equity - plan.equityAtClose)} drawn as it rises over ~${plan.months} mo`}
            strong
            bad={!canFund}
            title="The whole sponsor share — closing cheque plus monthly draws during construction. Budget for all-in, not the first cheque alone."
          />
          <Row
            k="Programme"
            v={`${sf(plan.sf)} · ${fl} fl · ${devUseLabel(use)} · ${plan.months} mo`}
          />
          <Row
            k="Yield on cost"
            v={`${plan.yieldOnCost.toFixed(2)}% vs ${plan.requiredYield.toFixed(2)}% req`}
            strong
            bad={plan.hurdleRatio < 1}
          />
          {nb && Math.abs(nb.drift) >= 0.5 && (
            <Row k="Neighbourhood" v={`${nb.drift > 0 ? "+" : ""}${nb.drift.toFixed(0)} demand since 2000 on this block`} />
          )}
        </div>
      )}
      {plan && <LocSplitHint need={closeCheque} game={game} parcels={parcels} />}

      <div className="btn-row" style={{ marginBottom: 8 }} role="tablist" aria-label="Build desk">
        {BUILD_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={"btn" + (tab === t.id ? " btn-on" : "")}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "programme" && (
        <>
          <div className="btn-row">
            {USES.map((u) => (
              <button key={u} className={"btn" + (use === u ? " btn-on" : "")} onClick={() => setUse(u)}>{devUseLabel(u)}</button>
            ))}
          </div>
          {(use === "office" || use === "retail" || use === "industrial") && (
            <div className="page-section" style={{ marginTop: 8 }}>
              <div className="page-section-head">Delivery strategy</div>
              {bts ? (
                <>
                  <div className="grid">
                    <Row k="Build-to-suit tenant" v={`${bts.name} · credit ${CREDIT_LABEL[bts.credit]}`} strong />
                    <Row k="Commitment" v={`${sf(bts.sf)} · ${(bts.termM / 12).toFixed(0)} years`} />
                    <Row k="Rent" v={`$${bts.rentPsf.toFixed(2)}/sf · below market for certainty`} />
                    <Row k="Tenant work" v={`$${bts.tiPsf}/sf · ${bts.recovery.toUpperCase()}`} />
                  </div>
                  <div className="hint">
                    Terms arrived off the listing. Break ground on their shell, or send them away and go back to spec.
                  </div>
                  <button className="btn" onClick={() => useStore.getState().clearBts(bbl)}>Return to spec</button>
                </>
              ) : btsOffer ? (
                <>
                  <div className="grid">
                    <Row
                      k="On the BTS book"
                      v={`${btsOffer.floors} fl of ${btsOffer.use} · since ${monthLabel(btsOffer.sinceM)}${
                        game.month - btsOffer.sinceM > 0
                          ? ` · ${game.month - btsOffer.sinceM} month${game.month - btsOffer.sinceM === 1 ? "" : "s"} waiting`
                          : ""
                      }`}
                      strong
                    />
                  </div>
                  <div className="hint">
                    A credit tenant who will commit before groundbreak is scarce — they turn up when demand, the build
                    climate and the size of the shell say so. Change the programme below and re-list to update what you
                    are shopping; pull the listing to go back to pure spec.
                  </div>
                  <div className="btn-row">
                    {(btsOffer.use !== use || btsOffer.floors !== fl || Math.abs(btsOffer.coverage - cov) > 0.001) && (
                      <button className="btn" onClick={() => useStore.getState().proposeBts(bbl, use, fl, cov)}>
                        Update listing · {fl} fl of {use}
                      </button>
                    )}
                    <button className="btn" onClick={() => useStore.getState().clearBts(bbl)}>Pull the listing</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="hint">
                    Build on spec for market rent and lease-up risk, or list the shell for a build-to-suit: one credit
                    tenant before groundbreak, lower rent and concentration risk in exchange for long term, day-one
                    occupancy and stronger financing. An anchor arrives when one arrives — this is a listing, not a desk
                    that invents tenants on demand.
                  </div>
                  <button className="btn" onClick={() => useStore.getState().proposeBts(bbl, use, fl, cov)}>
                    List for build-to-suit
                  </button>
                </>
              )}
            </div>
          )}
          <Slider
            label="Stories"
            value={fl}
            min={1}
            max={maxFl}
            step={1}
            onChange={setFloors}
            format={(v) => `${v} ${v === 1 ? "floor" : "floors"}`}
            marks={[{ at: Math.max(1, Math.round(maxFl * 0.25)), label: "low" }, { at: Math.max(1, Math.round(maxFl * 0.6)), label: "mid" }, { at: maxFl, label: `max ${maxFl}` }]}
            hint={use === "retail"
              ? `Shops are two storeys. The second floor already rents at a discount to the first and there is no third — what you want on a site this size is ${retailWantsMixed(rec, cov) ? "the mixed-use programme, which puts shops at grade under offices and flats" : "exactly this"}.`
              : plan
                ? `${sf(plan.sf)} of building at ${plan.far} FAR (envelope ${plan.farMax.toFixed(1)}). ${
                  // WHICH CEILING YOU ARE ACTUALLY STANDING ON. The hint used to
                  // name all three at once, which tells you nothing about the
                  // site in front of you. `maxFloorsFor` is the min of zoning,
                  // structure and the use's own shape, so comparing its answer
                  // against the two it minimises over says which one bound —
                  // read off the same functions the planner runs, never a
                  // second copy of their arithmetic.
                  MAX_FLOORS_BY_USE[use] !== undefined && maxFl === MAX_FLOORS_BY_USE[use]
                    ? `The cap is the use: ${devUseLabel(use)} does not stack past ${maxFl}.`
                    : maxFl === physicalMaxFloors(rec.lotArea * cov)
                      ? `The cap is STRUCTURE, not zoning: a ${sf(Math.round(rec.lotArea * cov))} plate cannot carry more than ${maxFl} floors of core and stair. Widen the footprint and the site carries more.`
                      : `The cap is ZONING: the envelope runs out at ${maxFl} floors on this footprint. Narrow the footprint and the same envelope goes higher.`
                }`
                : undefined}
          />
          <Slider
            label="Footprint"
            value={cov}
            min={0.08}
            max={0.9}
            step={0.01}
            onChange={(v) => { setCov(v); setFloors((f) => Math.min(f, maxFloorsFor(rec, v, use))); }}
            format={(v) => `${Math.round(v * 100)}% of the lot · ${sf(rec.lotArea * v)} plate`}
            marks={[{ at: 0.15, label: "corner" }, { at: 0.35, label: "tower" }, { at: 0.6, label: "block" }, { at: 0.85, label: "podium" }]}
            hint={(() => {
              // THE SLIDER USED TO PROMISE THE OPPOSITE OF WHAT IT DOES HERE.
              //
              // "A slim tower goes higher on the same envelope" is true where
              // zoning is the binding ceiling, and on this island it almost
              // never is: the median lot is under 5,000 ft², so narrowing the
              // footprint takes the plate below what a core can serve and the
              // storey ceiling FALLS. Measured on the top demand decile, the
              // same lot carried 9 floors at the 32% mark and 23 at 78%.
              //
              // Rather than assert either story, ask the same function the
              // planner asks, at a wider and a narrower dial, and report what
              // it says about THIS lot.
              const wider = maxFloorsFor(rec, Math.min(0.9, cov + 0.15), use);
              const slimmer = maxFloorsFor(rec, Math.max(0.08, cov - 0.15), use);
              const dir = wider > maxFl
                ? `Widening to ${Math.round(Math.min(0.9, cov + 0.15) * 100)}% carries ${wider} floors — the plate, not the envelope, is what is holding the height down.`
                : slimmer > maxFl
                  ? `Narrowing to ${Math.round(Math.max(0.08, cov - 0.15) * 100)}% carries ${slimmer} floors on the same envelope.`
                  : `${maxFl} floors either way — you are between the two ceilings.`;
              return `${dir} On a big site you can put up something small and keep the rest of the land.`;
            })()}
          />
          {/* WHAT THE SITE YIELDS, AND WHAT IT IMPLIES — see plateVerdict. The
              desk printed the plate and never said whether anybody leases one,
              or what the height-to-width of the result would be. Both are
              facts about the design on the dials, so they belong beside the
              dials, and neither of them changes the design. */}
          {plan && (() => {
            const plateSf = Math.round(rec.lotArea * cov);
            const v = plateVerdict(plateSf, use);
            // The engine's own slenderness identity, at the engine's own floor
            // height: `physicalMaxFloors` caps floors at 1.2·√plate, which is
            // MAX_SLENDERNESS / FLOOR_HEIGHT_FT. Reading the ratio back off the
            // same two constants is that identity, not a second opinion.
            const ratio = (plan.floors * FLOOR_HEIGHT_FT) / Math.sqrt(Math.max(1, plateSf));
            return (
              <div className="page-section" style={{ marginTop: 6 }}>
                <div className="page-section-head">The site, and what it will carry</div>
                <div className="grid">
                  <Row
                    k="Floor plate"
                    v={`${sf(plateSf)} · ${v.word}`}
                    strong
                    bad={v.bad}
                    title={v.note}
                  />
                  <Row
                    k="Against this city"
                    v={`median new building here is ${sf(REF_PLATE_SF)}`}
                    title="The plate a median new building in this town actually carries, measured across every vacant lot planned at its own best height and footprint."
                  />
                  <Row
                    k="Height : width"
                    v={`${(plan.floors * FLOOR_HEIGHT_FT).toFixed(0)} ft on a ${Math.round(Math.sqrt(Math.max(1, plateSf)))} ft plate · ${ratio.toFixed(1)}:1`}
                    bad={ratio > 10}
                    title={`Past about 6:1 the lateral system stops being an afterthought and somebody pays for it. Past 10:1 it is a specialist product — New York's super-slenders reach ${MAX_SLENDERNESS}:1 and beyond, and they are built as a product, not as a default.`}
                  />
                </div>
                <div className={"hint" + (v.bad ? " alarm" : "")}>
                  {v.note}
                  {ratio > 10
                    ? " At this height on this plate the frame is a specialist job — a broad base and a shaft that steps in as it rises is what gets built."
                    : ratio > 6
                      ? " Slender enough that the frame is a real line in the budget."
                      : ""}
                  {v.bad ? " Assembling the lot next door is the only thing that moves it." : ""}
                </div>
              </div>
            );
          })()}
          {use === "mixed" && (
            <>
              <div className="page-section" style={{ marginTop: 6 }}>What goes where</div>
              {(["retail", "office", "multifamily"] as const).map((u) => (
                <Slider
                  key={u}
                  label={USE_WORD[u]}
                  value={stack[u]}
                  min={0}
                  max={u === "retail" ? retailPctMax : 100}
                  step={u === "retail" && retailPctMax < 20 ? 1 : 5}
                  onChange={(v) => setSplit(() => {
                    const others = (["retail", "office", "multifamily"] as const).filter((k) => k !== u);
                    const restNow = others.reduce((a, k) => a + stack[k], 0);
                    const rest = 100 - v;
                    const next = { ...stack, [u]: v } as Stack;
                    for (const k of others) next[k] = restNow > 0 ? Math.round((stack[k] / restNow) * rest) : Math.round(rest / 2);
                    next[others[1]] = Math.max(0, 100 - v - next[others[0]]);
                    return next;
                  })}
                  format={(v) => `${v}%${planMax ? ` · ${sf(Math.round(planMax.sf * (planMax.mix[u] ?? 0)))}` : ""}`}
                  marks={u === "retail"
                    ? [{ at: retailPctMax, label: `max ${retailPctMax}%` }]
                    : [{ at: 15, label: "" }, { at: 50, label: "half" }]}
                  hint={u === "retail"
                    ? `Shops at grade and one above it — past the second floor nobody comes, so two floor plates is the whole allowance, which on ${fl} ${fl === 1 ? "storey" : "storeys"} is ${retailPctMax}% of the building and no more. Take the storeys down if you want a shop building; leave them up and the offices and flats take the height.`
                    : u === "office" ? "The swing leg: the highest rent of the three and the one that empties first in a downturn."
                    : "Flats are the cheapest to build and the thinnest margin. They also let in every market, which is the point of putting them in the stack."}
                />
              ))}
              <div className="hint">
                {stack.retail + stack.office + stack.multifamily !== 100
                  ? "The stack has to add to 100%."
                  : `Shops ${stack.retail}% · offices ${stack.office}% · flats ${stack.multifamily}%. Anything under 3% is dropped — that is a lobby, not a use.`}
              </div>
            </>
          )}
          {planMax && (
            <>
              <div className="page-section" style={{ marginTop: 6 }}>How it is cut up</div>
              {(Object.keys(planMax.mix) as BuiltClass[]).filter((u) => (planMax.mix[u] ?? 0) > 0.02).map((u) => {
                const legSf = planMax.sf * (planMax.mix[u] ?? 0);
                const r = unitRange(legSf, u);
                const n = units[u] ?? r.typical;
                const per = suiteSfForUnits(legSf, u, n);
                return (
                  <Slider
                    key={u}
                    label={`${USE_WORD[u]} spaces · ${sf(Math.round(legSf))}`}
                    value={Math.max(r.min, Math.min(r.max, n))}
                    min={r.min}
                    max={r.max}
                    step={1}
                    onChange={(v) => setUnits((p) => ({ ...p, [u]: v }))}
                    format={(v) => `${v} ${v === 1 ? "space" : "spaces"} · ${sf(per)} each`}
                    marks={[{ at: r.typical, label: "typical" }, { at: r.max, label: `max ${r.max}` }]}
                    hint={legSf > SUITE_BOUNDS[u].min && per <= SUITE_BOUNDS[u].min * 1.15
                      ? `${sf(SUITE_BOUNDS[u].min)} is the floor for ${USE_WORD[u].toLowerCase()} — below that it is not a space, it is a cupboard.`
                      : per >= SUITE_BOUNDS[u].max * 0.85
                        ? "Spaces this big mean one tenant, or none. Single-tenant buildings are a real product and a slow let."
                        : "Small spaces lease faster and cost far more to fit out and to run. Big ones sit empty longer and almost never turn."}
                  />
                );
              })}
            </>
          )}
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button type="button" className="btn" onClick={() => setTab("design")}>Next · Design</button>
          </div>
        </>
      )}

      {tab === "design" && (
        <>
          <Slider
            label="Build quality"
            value={spec}
            min={0}
            max={1}
            step={0.05}
            onChange={setSpec}
            format={(v) => v < 0.35 ? "Value" : v < 0.65 ? "Standard" : v < 0.85 ? "Premium" : "Trophy"}
            marks={[{ at: 0.25, label: "value" }, { at: 0.5, label: "standard" }, { at: 0.75, label: "premium" }, { at: 1, label: "trophy" }]}
            hint={`Hard cost ×${specCostMult(spec).toFixed(2)} today and a higher condition ceiling forever. Trophy costs more to build but holds rent longer.`}
          />
          <div className="page-section" style={{ marginTop: 6 }}>Design preset</div>
          <div className="btn-row">
            {([
              { label: "Box", cov: 0.78, spec: 0.28 },
              { label: "Standard", cov: 0.6, spec: 0.5 },
              { label: "Tower", cov: 0.32, spec: 0.55 },
              { label: "Signature", cov: 0.48, spec: 0.88 },
            ] as const).map((p) => (
              <button
                key={p.label}
                type="button"
                className={"btn" + (Math.abs(cov - p.cov) < 0.02 && Math.abs(spec - p.spec) < 0.04 ? " btn-on" : "")}
                // WHAT THE PRESET COSTS YOU IN STOREYS, ON THIS LOT. "Tower"
                // narrows the footprint, which buys height only where zoning is
                // the binding ceiling. On a small lot it is not — the plate
                // stops carrying a core — and the preset makes the building
                // SHORTER. Measured on the top demand decile: 9 floors at the
                // 32% mark against 23 at 78%, on the same dirt.
                title={`${Math.round(p.cov * 100)}% footprint · ${sf(Math.round(rec.lotArea * p.cov))} plate · carries ${maxFloorsFor(rec, p.cov, use)} floors here`}
                onClick={() => {
                  setCov(p.cov);
                  setSpec(p.spec);
                  setFloors((f) => Math.min(f, maxFloorsFor(rec, p.cov, use)));
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="hint">
            Presets set footprint and quality together. Stories stay on Programme — change them there if the plate no longer fits the envelope.
          </div>
          <div className="btn-row">
            {/* The contract is the developer's real hedge and nobody ever shows it
                to you. In a boom the guaranteed price is the cheapest money on the
                board; in a flat market it is four points of nothing. */}
            <button
              className={"btn" + (contract === "gmp" ? " btn-on" : "")}
              title="Guaranteed maximum price: +4% on hard cost, and the contractor carries escalation and most change orders."
              onClick={() => setContract("gmp")}
            >
              Guaranteed max price
            </button>
            <button
              className={"btn" + (contract === "costplus" ? " btn-on" : "")}
              title="Cost-plus: cheaper today, but the unspent budget moves with the market and every change order is yours."
              onClick={() => setContract("costplus")}
            >
              Cost-plus
            </button>
          </div>
          {plan && (
            <div className="page-section" style={{ marginTop: 8 }}>
              <div className="page-section-head">Costs</div>
              <div className="grid">
                {/* ONE FLOOR-TO-FLOOR. This said 3.4 m, which is neither the
                    12.5 ft the storey ceiling is computed from nor the 3.55 m
                    the map draws — a third answer to "how tall is it". The
                    engine's constant is the one the slenderness cap is built
                    on, so it is the one the desk quotes. */}
                <Row k="Building" v={`${sf(plan.sf)} · ${plan.floors} fl · ${(plan.floors * FLOOR_HEIGHT_FT).toFixed(0)} ft tall`} strong />
                <Row k="FAR used" v={`${plan.far} of ${plan.farMax.toFixed(1)}`} />
                <Row k="Hard cost" v={`${usd(plan.hardCost)} · $${(plan.hardCost / Math.max(1, plan.sf)).toFixed(0)}/sf`} />
                <Row k="Soft cost" v={usd(plan.softCost)} />
                {plan.demo > 0 && <Row k="Demolition" v={usd(plan.demo)} />}
                <Row k="Contingency" v={`${usd(plan.contingency)} · yours if unspent`} />
                <Row k="Lease-up reserve" v={`${usd(plan.leaseUp)} · fit-out and carry until full`} />
                <Row k="Cost to build" v={`${usd(plan.costTotal)} · $${(plan.costTotal / Math.max(1, plan.sf)).toFixed(0)}/sf`} />
              </div>
            </div>
          )}
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button type="button" className="btn" onClick={() => setTab("programme")}>Back · Programme</button>
            <button type="button" className="btn" onClick={() => setTab("financing")}>Next · Financing</button>
          </div>
        </>
      )}

      {tab === "financing" && (
        <>
          {plan && (
            <div className="btn-row" style={{ marginTop: 6 }}>
              {constructionQuotes(game, plan.mix, plan.costTotal).map((q) => (
                <button
                  key={q.lender}
                  className={"btn" + (plan.lender === q.lender ? " btn-on" : "")}
                  disabled={!q.open}
                  title={q.why ?? lenderBlurb(q.lender)}
                  onClick={() => setBank(q.lender)}
                >
                  {q.lender.split(" ")[0]} · {q.open ? `${pct(q.ratePct)} · ${Math.round(q.ltcMax * 100)}% LTC · ${(q.points * 100).toFixed(1)} pts` : "not quoting"}
                </button>
              ))}
            </div>
          )}
          {plan && plan.ltcMax > 0 && (
            <Slider
              label="Construction leverage"
              value={ltcWant}
              min={0}
              max={1}
              step={0.05}
              onChange={setLtcWant}
              format={() => plan.commitment > 0
                ? `${Math.round(plan.ltc * 100)}% of cost · ${usd(plan.commitment)}`
                : "all equity"}
              marks={[{ at: 0, label: "all equity" }, { at: 0.7, label: "" }, { at: 1, label: `max ${Math.round((plan.ltcMax) * 100)}%` }]}
              hint={`The lender will go to ${Math.round(plan.ltcMax * 100)}% of cost on this deal. Take less and the equity cheque grows but the takeout loan you inherit at delivery shrinks — an empty building with a small loan survives a slow lease-up; one with a big loan doesn't.`}
            />
          )}
          {plan ? (
            <>
              <div className="page-section" style={{ marginTop: 8 }}>
                <div className="page-section-head">Financing</div>
                <div className="grid">
                  <Row
                    k={`Construction loan (${Math.round(plan.ltc * 100)}%)`}
                    v={plan.commitment > 0 ? `${usd(plan.commitment)} @ ${pct(plan.ratePct)} · ${plan.lender}` : "none — nobody will fund it"}
                    bad={plan.commitment === 0 && plan.ltcMax > 0 && ltcWant > 0}
                  />
                  <Row k="Origination" v={plan.pointsCost > 0 ? `${usd(plan.pointsCost)} at close` : "—"} />
                  <Row k="Interest reserve" v={plan.interestReserve > 0 ? `${usd(plan.interestReserve)} — lender carries it` : "—"} />
                  <Row k="Land in basis" v={`${usd(plan.landBasis)} · $${(plan.landBasis / Math.max(1, plan.sf)).toFixed(0)}/sf`} />
                  <Row
                    k="All in"
                    v={`${usd(plan.basisTotal)} · $${(plan.basisTotal / Math.max(1, plan.sf)).toFixed(0)}/sf`}
                    strong
                    title="Land, construction, contingency, lease-up and interest reserves, origination — the yield-on-cost denominator."
                  />
                  <Row
                    k="Yield on cost"
                    v={`${plan.yieldOnCost.toFixed(2)}% vs ${plan.requiredYield.toFixed(2)}% req · ${plan.exitCap.toFixed(2)}% exit`}
                    strong
                    bad={plan.hurdleRatio < 1}
                  />
                </div>
              </div>
              <div className="page-section" style={{ marginTop: 8 }}>
                <div className="page-section-head">Equity</div>
                <div className="grid">
                  <Row k="At closing" v={`${usd(closeCheque)}`} strong bad={closeCheque > spendable(game, parcels).total} />
                  <Row
                    k="Drawn during build"
                    v={`${usd(plan.equity - plan.equityAtClose)} over ~${plan.months} months`}
                    bad={plan.equity - plan.equityAtClose > game.cash - plan.equityAtClose}
                  />
                  <Row k="All-in equity" v={usd(equityRequired)} strong bad={!canFund} />
                  <Row
                    k="Change-order margin"
                    v={`${usd(plan.contingency)} contingency${plan.contract === "costplus" ? " — past it, yours under cost-plus" : ""}`}
                    bad={plan.contract === "costplus"}
                  />
                  <Row k="Schedule" v={`${plan.months} months`} />
                  {(() => {
                    const commitCap = plan.equity + plan.pointsCost + Math.round(plan.costTotal * 0.06);
                    const fundable = spendable(game, parcels).total;
                    const shortAll = Math.max(0, commitCap - fundable);
                    const shortClose = Math.max(0, closeCheque - fundable);
                    if (shortAll <= 0 && shortClose <= 0) return null;
                    return (
                      <Row
                        k="Equity short"
                        v={shortClose > 0
                          ? `${usd(shortClose)} at close — cut massing or raise cash`
                          : `${usd(shortAll)} to finish incl. line + change orders`}
                        bad
                      />
                    );
                  })()}
                </div>
              </div>
              {plan.lenderNote && <div className="hint">{plan.lenderNote}</div>}
              <div className="hint">
                Budget <b>{usd(equityRequired)}</b> all-in — not just the <b>{usd(closeCheque)}</b> at closing.
                Delivery lifts nearby demand before lease-up fills the floors.
                {!canFund && " This massing is past what you can finish."}
              </div>
              <div className="btn-row">
                <button type="button" className="btn" onClick={() => setTab("design")}>Back · Design</button>
                <button
                  className="btn btn-buy"
                  disabled={!canFund}
                  onClick={() => useStore.getState().develop(bbl, use, fl, cov, contract, plan.ltcMax * ltcWant, { mix: customMix, suites: suiteChoice, bts }, plan.lender, spec)}
                  title={!canFund
                    ? `Equity short — needs ${usd(equityRequired)} all-in`
                    : `${usd(closeCheque)} at close, ${usd(plan.equity - plan.equityAtClose)} drawn during build.`}
                >
                  {canFund
                    ? `Break ground · ${usd(equityRequired)} equity all-in`
                    : `Cannot finish · short ${usd(Math.max(0, equityRequired + Math.round(plan.costTotal * 0.06) - spendable(game, parcels).total))}`}
                </button>
              </div>
            </>
          ) : (
            <div className="hint">Too small to build — add floors or cover more of the lot on Programme.</div>
          )}
        </>
      )}
    </div>
  );
}
