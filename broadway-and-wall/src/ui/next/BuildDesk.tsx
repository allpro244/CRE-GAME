/**
 * THE BUILD DESK, SIMPLE (owner, Oct 2026: "simplified much more … give the
 * player control, though much simpler and refined"). Five choices and a live
 * verdict, on one page:
 *
 *   Use     what the district hosts, and a product where the lot carries one
 *   Size    one dial: storeys, at the widest footprint that height allows
 *   Tier    the four build qualities (BUILD_TIERS)
 *   Look    a form the lot takes (Unreal) and a facade from a short list
 *   Lender  which construction desk, each with its rate and most it lends
 *   Loan    none, half or all the construction lender offers, terms shown
 *
 * The verdict — profit, yield against the hurdle, the cheque — is the
 * engine's own (scheme.ts deskScheme → planDevelopment), and so is the
 * footer's Break ground, which reads the same scheme. The model is the
 * building itself (SchemeViewer), redrawn on every choice.
 */
import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/state/store";
import { useHeldGame } from "@/ui/heldGame";
import Slider from "@/ui/Slider";
import SchemeViewer from "@/ui/panels/SchemeViewer";
import { dominantOf } from "@/engine/proforma";
import { planDevelopment, takeoutHedgeCost, takeoutHedgeRequired, takeoutRead, maxRetailShare, BTS_TERM_MIN_Y, BTS_TERM_MAX_Y, btsTermY, MIN_COVERAGE } from "@/engine/dev";
import { maxOutside, syndicateBar } from "@/engine/syndicate";
import { raisePreview, type RaiseJob } from "@/engine/raise";
import { committedTotal, type PitchStyle } from "@/engine/investors";
import { ownedHoldingValue } from "@/engine/value";
import { BUILD_TIERS, buildTier } from "@/engine/value";
import { START_YEAR, type DevDraft, type DevUse } from "@/engine/types";
import { productsForUse, layoutProduct } from "@/engine/products";
import { KITS, KIT_GROUPS } from "@/engine/renderView";
import { FACADE_STYLES, FACADE_GROUPS, TRIM_PAINTS, ROOF_CHOICES, CROWN_CHOICES, CROWN_MIN_FLOORS, type FacadeGroup } from "@/map/real/RealCity";
import { SIGNATURE_FORMS, SIGNATURE_MIN_FLOORS } from "@/map/real/signature";
import type { BuildingDesign } from "@/engine/types";
import { UNREAL_HOST, formsForLot } from "@/state/unrealHost";
import { usd, sf } from "@/ui/format";
import { devUseLabel } from "@/ui/panels/shared";
import { deskScheme, bestStarts, coverFor, productName, type DeskScheme } from "./scheme";
import "./desks.css";
import { WhyButton } from "@/ui/WhyChain";
import { costWhy, landWhy } from "@/ui/whyLinks";

/** The ground storey (BuildingDesign.base). A trading ground floor keeps its shops: arcade only. */
const BASES: { key: NonNullable<BuildingDesign["base"]>; name: string; blurb: string; minFloors: number; shops: boolean }[] = [
  { key: "lobby", name: "Glass lobby", blurb: "Double-height glass lobby", minFloors: 3, shops: false },
  { key: "stone", name: "Stone base", blurb: "Rusticated stone ground storey, round-headed openings", minFloors: 3, shops: false },
  { key: "columns", name: "Columns", blurb: "Building on columns, lobby set back", minFloors: 3, shops: false },
  { key: "arcade", name: "Arcade", blurb: "Round arches along the street", minFloors: 2, shops: true },
  { key: "plain", name: "Same as facade", blurb: "Facade runs to the pavement", minFloors: 1, shops: false },
];

/**
 * THE LOOK, FROM A SHORT LIST. One facade of each kind a developer actually
 * chooses between, each the Unreal kit and the web pattern-book style that
 * draw it; "fits the street" lets the period and the block choose, as for
 * every other building in town. Looks only: nothing priced reads it.
 */
const LOOKS: { id: string; label: string; kit?: string; facade?: string }[] = [
  { id: "street", label: "Street" },
  { id: "brick", label: "Brick", kit: "B13", facade: "brick" },
  { id: "stone", label: "Limestone", kit: "B03", facade: "stone" },
  { id: "deco", label: "Deco", kit: "B15", facade: "deco" },
  { id: "grid", label: "Concrete", kit: "B19", facade: "grid" },
  { id: "glass", label: "Glass", kit: "B06", facade: "glass" },
  { id: "dark", label: "Dark glass", kit: "B20", facade: "blackglass" },
];

// the sweep is a hundred pro formas: once per lot per month
const STARTS = new Map<string, ReturnType<typeof bestStarts>>();

function Chip({ on, onClick, children, title, disabled, tab }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string; disabled?: boolean; tab?: boolean }) {
  return (
    <button type="button" className={"bd-chip" + (tab ? " tab" : "") + (on ? " on" : "")} onClick={onClick} title={title} disabled={disabled} aria-pressed={on}>
      {children}
    </button>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="bd-row">
      <div className="bd-k">{k}</div>
      <div className="bd-v">{children}</div>
    </div>
  );
}

/** The building classes, in the order a developer thinks of them. */
const KINDS: DevUse[] = ["office", "multifamily", "mixed", "retail", "industrial"];

const pct2 = (x: number) => `${x.toFixed(2)}%`;
const ratio = (x: number) => `${x.toFixed(2)}×`;

export function BuildDesk({ bbl, commit = false }: { bbl: string; commit?: boolean }) {
  const game = useHeldGame(bbl);
  useStore((s) => s.game?.holdings[bbl]?.devDraft);
  const parcels = useStore((s) => s.parcels)!;
  const d = deskScheme(game, parcels, bbl);
  const { rec, plan, use, floors, design } = d;

  // every write pins the whole scheme, so the draft is the desk
  const set = (patch: Partial<DevDraft>) => useStore.getState().setDevDraft(bbl, {
    use, floors, cov: d.cov, spec: d.spec, ltcWant: d.ltcWant, design, product: d.product?.key, ...patch,
  });
  const setSize = (f: number) => set({ floors: f, cov: coverFor(rec, use, f) });
  const setUse = (u: DevUse, product?: string) => {
    const fl = Math.max(1, floors);
    const { form: _f, formRetained: _r, formSkin: _s, ...look } = design;
    set({ use: u, product, floors: fl, cov: coverFor(rec, u, fl), design: look });
  };

  // EACH LENDER'S MOST ON THIS JOB (owner, Oct 2026: "add a max LTV ... for each
  // lender"): its own plan's loan-to-cost, which the job's value can hold below
  // the desk's sheet maximum. Priced only here, not in the scheme sweep.
  const [, , , , , customArgs, , specArg] = d.commitArgs;
  const lenderKey = JSON.stringify([bbl, game.month, use, floors, d.cov, specArg, customArgs, d.quotes.map((q) => q.lender)]);
  const lenderMax = useMemo(() => {
    const out: Record<string, number> = {};
    for (const q of d.quotes) {
      if (!q.open || !(q.ltcMax > 0)) continue;
      out[q.lender] = planDevelopment(game, parcels, bbl, use, floors, d.cov, "gmp", undefined, customArgs, q.lender, specArg)?.ltcMax ?? 0;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lenderKey]);

  // the starting points: the best three schemes on the lot
  const starts = useMemo(() => {
    const k = `${game.seed}:${game.month}:${bbl}:${game.holdings[bbl]?.costBasis ?? 0}`;
    if (!STARTS.has(k)) { if (STARTS.size > 40) STARTS.clear(); STARTS.set(k, bestStarts(game, parcels, bbl)); }
    return STARTS.get(k)!;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.seed, game.month, bbl, game.holdings[bbl]?.costBasis]);

  // THE MODEL: what the engine will record at delivery
  const year = START_YEAR + Math.floor(((game.month ?? 0) + (plan?.months ?? 0)) / 12);
  const cls = plan ? dominantOf(plan.mix) : use === "mixed" ? "office" : use;
  const shops = plan ? (plan.mix.retail ?? 0) > 0.001 : use === "retail";
  const cov = plan?.coverage ?? d.cov;
  const previewKey = JSON.stringify([bbl, use, floors, cov, design, cls, shops, year, !!plan]);
  useEffect(() => {
    useStore.getState().setDesignPreview(plan && floors >= 1 ? { bbl, use, floors, cov, design, cls, shops, year } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);
  useEffect(() => () => { if (!useStore.getState().designPeek) useStore.getState().setDesignPreview(null); }, []);

  // THE FORMS THIS LOT TAKES at this height (Unreal solves them on the lot's ring)
  const forms = useMemo(() => (d.product ? []
    : UNREAL_HOST ? formsForLot(bbl, floors, cov, cls, year)
      : (() => { try { return (window as unknown as { __three?: { formsOn?: (b: string, f: number, c: number, k: string, y: number) => ReturnType<typeof formsForLot> } }).__three?.formsOn?.(bbl, floors, cov, cls, year) ?? []; } catch { return []; } })()),
    [bbl, floors, cov, cls, year, d.product]);
  const formNow = design.form ? forms.find((f) => f.key === design.form) : undefined;
  useEffect(() => {
    // a form the lot no longer takes goes; one it still takes is re-measured
    if (!design.form) return;
    if (!formNow) set({ design: { ...design, form: undefined, formRetained: undefined, formSkin: undefined } });
    else if (Math.abs((design.formRetained ?? 1) - formNow.retained) > 0.005 || Math.abs((design.formSkin ?? 1) - formNow.skin) > 0.005)
      set({ design: { ...design, formRetained: formNow.retained, formSkin: formNow.skin } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forms, design.form]);

  const pickLook = (l: (typeof LOOKS)[number]) => {
    const { kit: _k, facade: _f, kitColour: _c, ground: _g, top: _t, bays: _b, ...rest } = design;
    const kit = KITS.find((k) => k.key === l.kit);
    set({ design: !l.kit ? rest : UNREAL_HOST && kit ? { ...rest, kit: kit.key, facade: kit.family } : { ...rest, facade: l.facade } });
  };
  const tier = buildTier(d.spec);
  const [lookEra, setLookEra] = useState<(typeof KITS)[number]["group"]>(() => KITS.find((k) => k.key === design.kit)?.group ?? "prewar");
  // the web catalogue is ~100 facades: one category at a time (owner, Oct 2026: "right now its crazy")
  const styles = FACADE_STYLES.filter((f) => f.maxFloors >= floors);
  const groups = FACADE_GROUPS.filter((g) => styles.some((f) => f.group === g.key));
  const [lookGroup, setLookGroup] = useState<FacadeGroup>(() => FACADE_STYLES.find((f) => f.key === design.facade?.split("#")[0])?.group ?? "street");
  const groupNow = groups.some((g) => g.key === lookGroup) ? lookGroup : groups[0]?.key;
  // THE REST OF THE DESIGN (owner, Oct 2026: "there used to be more options
  // ... like the setback"): colourway, ground storey, top, landmark form and
  // trim, cut with the old Design tab and still drawn by the renderer.
  const setDesign = (patch: Partial<BuildingDesign>) => {
    const nd = { ...design, ...patch } as BuildingDesign;
    for (const k of Object.keys(nd) as (keyof BuildingDesign)[]) if (nd[k] === undefined) delete nd[k];
    set({ design: nd });
  };
  const styleNow = FACADE_STYLES.find((f) => f.key === design.facade?.split("#")[0]);
  const variantNow = +(design.facade?.split("#")[1] ?? 0);
  // EVERY OPTION IS SHOWN (owner, Nov 2026: "make sure all available options
  // are shown"): one the building cannot take at this height is greyed with the
  // reason on hover, rather than vanishing as the floors slider moves.
  const baseWhy = (b: (typeof BASES)[number]) => floors < b.minFloors ? `Needs ${b.minFloors}+ floors` : shops && !b.shops ? "Shops at grade keep their shopfronts: only the arcade goes over them" : undefined;
  const tops = [
    ...ROOF_CHOICES.map((r) => ({ id: `roof:${r.key}`, name: r.name, patch: { roof: r.key, crown: undefined, signature: undefined } as Partial<BuildingDesign>,
      why: floors > r.maxFloors ? `Up to ${r.maxFloors} floors` : r.key === "flat" && floors >= CROWN_MIN_FLOORS ? "A tower's flat top is the crown “Flat top”" : undefined })),
    ...CROWN_CHOICES.map((c) => ({ id: `crown:${c.key}`, name: c.name, patch: { crown: c.key, roof: undefined, signature: undefined } as Partial<BuildingDesign>,
      why: floors < CROWN_MIN_FLOORS ? `Towers of ${CROWN_MIN_FLOORS}+ floors` : undefined })),
  ];
  const topNow = design.signature ? "signature" : design.crown ? `crown:${design.crown}` : design.roof ? `roof:${design.roof}` : "auto";
  const landmarks = SIGNATURE_FORMS.filter((f) => year >= f.from);
  const allStyles = FACADE_STYLES.filter((f) => f.group === groupNow);
  const lookName = design.kit ? KITS.find((k) => k.key === design.kit)?.name : styleNow?.name;
  // the widest footprint that still carries these floors; narrower is a slimmer building
  const covMax = Math.max(MIN_COVERAGE, coverFor(rec, use, floors));
  const contract = d.commitArgs[3];

  return (
    <div className="deal deal-wide build-desk">
      <Verdict d={d} />
      <div className="bd-grid">
        <div className="bd-model">
          <SchemeViewer height={UNREAL_HOST ? 300 : 260} />
        </div>
        <div className="bd-steps">
          {starts.length > 0 && (
            <div className="bd-best">
              <div className="bd-k">Start from the best schemes here</div>
              <div className="bd-v">
                {starts.map((s) => {
                  const on = s.use === use && (s.product ? s.product === d.product?.key : !d.product && s.floors === floors);
                  return (
                    <Chip key={s.use + s.floors + (s.product ?? "")} on={on} title="Yield on cost over the hurdle: 1.00× just clears it"
                      onClick={() => set(s.product ? { use: s.use, product: s.product } : { use: s.use, product: undefined, floors: s.floors, cov: coverFor(rec, s.use, s.floors) })}>
                      {s.product ? productName(s.product) : `${devUseLabel(s.use)} · ${s.floors} fl`}<span className="bd-sub"> {ratio(s.hurdle)} hurdle</span>
                    </Chip>
                  );
                })}
              </div>
            </div>
          )}

          <Step n={1} title="What to build" sum={`${d.product ? d.product.short : devUseLabel(use)} · ${tier.label}`}>
            {/* ONE PICKER FOR CLASS AND TYPE (owner, Nov 2026: "not very intuitive
                to switch between the main classes ... to get to their sub
                categories"): every class is a card with its own types inside, so
                any type is one click from anywhere. A type the lot cannot lay out,
                or a class zoning bars, is shown greyed with the reason. */}
            <div className="bd-kinds">
              {KINDS.map((u) => {
                const legal = d.legal.includes(u);
                const prods = productsForUse(u);
                const here = u === use;
                return (
                  <div key={u} className={"bd-kind" + (here ? " on" : "") + (legal ? "" : " off")} title={legal ? undefined : "This lot's zoning does not allow it"}>
                    <div className="bd-kind-name">{devUseLabel(u)}</div>
                    <div className="bd-kind-types">
                      <Chip on={here && !d.product} disabled={!legal} onClick={() => (here ? set({ product: undefined }) : setUse(u))}>Street building</Chip>
                      {prods.map((p) => {
                        const fits = !!layoutProduct(p, rec.lotArea);
                        return (
                          <Chip key={p.key} on={here && d.product?.key === p.key} disabled={!legal || !fits}
                            title={!fits ? `${p.label} · this lot is the wrong size for it` : `${p.label} · ${p.blurb}`}
                            onClick={() => (here ? set({ product: p.key }) : setUse(u, p.key))}>{p.short}</Chip>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            {KINDS.some((u) => productsForUse(u).some((p) => !layoutProduct(p, rec.lotArea))) && (
              <div className="bd-terms bd-inline">Greyed types need a different lot size ({sf(rec.lotArea)} here) · hover one for why</div>
            )}
            {d.bar && <div className="bd-warn">{d.bar}</div>}
            <Programme d={d} set={set} />
            <Row k="Quality">
              {BUILD_TIERS.map((t) => (
                <Chip key={t.key} on={tier.key === t.key} title={t.blurb} onClick={() => set({ spec: t.spec })}>{t.label}</Chip>
              ))}
            </Row>
            <div className="bd-terms">{tier.blurb}</div>
          </Step>

          {!d.product && (
            <Step n={2} title="Size and shape" sum={plan ? `${floors} fl · ${sf(plan.sf)} · ${Math.round(cov * 100)}% of lot` : `${floors} fl`}>
              <Row k="Floors">
                <Slider label="Floors" value={floors} min={1} max={Math.max(1, d.top)} step={1} onChange={setSize}
                  format={() => `${floors} of ${d.top} fl${plan ? ` · ${sf(plan.sf)}` : ""}`} />
              </Row>
              <Row k="Footprint">
                <Slider label="Lot covered" value={Math.round(cov * 100)} min={Math.round(MIN_COVERAGE * 100)} max={Math.max(Math.round(MIN_COVERAGE * 100) + 1, Math.round(covMax * 100))} step={1}
                  disabled={covMax <= MIN_COVERAGE + 0.005} onChange={(v) => set({ cov: Math.min(covMax, v / 100) })}
                  format={(v) => `${v}% of lot${v >= Math.round(covMax * 100) ? " · widest at this height" : " · slimmer"}`} />
              </Row>
              {/* THE ENVELOPE IS FULL (owner: "the sqft stops growing"): past the
                  district's FAR more floors only slim the floorplate; the way out is a FAR filing */}
              {plan && plan.far >= plan.farMax - 0.05 && <div className="bd-terms">
                At the FAR limit ({plan.farMax.toFixed(1)}): more floors only slim the plate ·{" "}
                <button type="button" className="bd-link" onClick={() => {
                  useStore.getState().openProperty(bbl, "summary");
                  window.setTimeout(() => useStore.setState({ pageJump: "Zoning variance" }), 120);
                }}>Seek more FAR</button>
              </div>}
              <Row k="Form">
                <Chip on={!design.form} onClick={() => set({ design: { ...design, form: undefined, formRetained: undefined, formSkin: undefined } })}>Plain block</Chip>
                {forms.map((f) => (
                  <Chip key={f.key} on={design.form === f.key} title={f.blurb}
                    onClick={() => set({ design: { ...design, form: f.key, formRetained: f.retained, formSkin: f.skin } })}>
                    {f.name}<span className="bd-sub"> {Math.round((f.retained - 1) * 100)}% floor area</span>
                  </Chip>
                ))}
                {forms.length === 0 && <span className="bd-terms bd-inline">No other form fits this lot at {floors} floors</span>}
              </Row>
            </Step>
          )}

          <Step n={3} title="Look" sum={lookName ?? "Fits the street"}>
            {UNREAL_HOST ? <>
              <Row k="Style">
                <Chip on={!design.kit && !design.facade} onClick={() => pickLook(LOOKS[0])}>Fits the street</Chip>
                {KIT_GROUPS.map((g) => <Chip key={g.key} tab on={lookEra === g.key} onClick={() => setLookEra(g.key)}>{g.name}</Chip>)}
              </Row>
              <Row k="">
                {KITS.filter((k) => k.group === lookEra).map((k) => (
                  <Chip key={k.key} on={design.kit === k.key} title={k.era}
                    onClick={() => { const { kit: _k, facade: _f, kitColour: _c, ground: _g, top: _t, bays: _b, ...rest } = design; set({ design: { ...rest, kit: k.key, facade: k.family } }); }}>{k.name}</Chip>))}
              </Row>
            </> : <>
              <Row k="Style">
                <Chip on={!design.kit && !design.facade} title="The period and the block choose, as for every other building in town" onClick={() => pickLook(LOOKS[0])}>Fits the street</Chip>
              </Row>
              <Row k="Family">
                {FACADE_GROUPS.map((g) => {
                  const ok = groups.some((x) => x.key === g.key);
                  return <Chip key={g.key} tab on={groupNow === g.key} disabled={!ok} title={ok ? undefined : `None of these go to ${floors} floors`} onClick={() => setLookGroup(g.key)}>{g.name}</Chip>;
                })}
              </Row>
              <Row k="Facade">
                {allStyles.map((f) => (
                  <Chip key={f.key} on={design.facade?.split("#")[0] === f.key} disabled={f.maxFloors < floors}
                    title={f.maxFloors < floors ? `${f.era} · up to ${f.maxFloors} floors` : f.era}
                    onClick={() => { const { kit: _k, facade: _f, kitColour: _c, ground: _g, top: _t, bays: _b, ...rest } = design; set({ design: { ...rest, facade: f.key } }); }}>{f.name}</Chip>))}
              </Row>
            </>}
            {!UNREAL_HOST && !d.product && <>
              <Row k="Colour">
                {styleNow && styleNow.variants.length > 1
                  ? styleNow.variants.map((v, i) => (
                    <Chip key={v} on={variantNow === i} onClick={() => setDesign({ facade: i ? `${styleNow.key}#${i}` : styleNow.key })}>{v}</Chip>))
                  : <span className="bd-terms bd-inline">{styleNow ? "One colourway" : "Pick a facade to choose its colourway"}</span>}
              </Row>
              <Row k="Ground">
                <Chip on={!design.base} onClick={() => setDesign({ base: undefined })}>{shops ? "Shopfronts" : "Auto"}</Chip>
                {BASES.map((b) => { const why = baseWhy(b); return <Chip key={b.key} on={design.base === b.key} disabled={!!why} title={why ? `${b.blurb} · ${why}` : b.blurb} onClick={() => setDesign({ base: b.key })}>{b.name}</Chip>; })}
              </Row>
              <Row k="Top">
                <Chip on={topNow === "auto"} onClick={() => setDesign({ roof: undefined, crown: undefined, signature: undefined })}>Auto</Chip>
                {tops.map((o) => <Chip key={o.id} on={topNow === o.id} disabled={!!o.why} title={o.why} onClick={() => setDesign(o.patch)}>{o.name}</Chip>)}
              </Row>
              <Row k="Landmark">
                <Chip on={!design.signature} onClick={() => setDesign({ signature: undefined })}>None</Chip>
                {floors >= SIGNATURE_MIN_FLOORS
                  ? landmarks.map((f) => <Chip key={f.key} on={design.signature === f.key} disabled={floors < f.minFloors}
                    title={floors < f.minFloors ? `${f.blurb} · needs ${f.minFloors}+ floors` : f.blurb}
                    onClick={() => setDesign({ signature: f.key, crown: undefined, roof: undefined })}>{f.name}</Chip>)
                  : <span className="bd-terms bd-inline">{landmarks.length} landmark towers from {SIGNATURE_MIN_FLOORS} floors</span>}
              </Row>
              <Row k="Trim">
                <Chip on={design.trim === undefined} onClick={() => setDesign({ trim: undefined })}>Auto</Chip>
                {TRIM_PAINTS.map((p, i) => <Chip key={p.name} on={design.trim === i} onClick={() => setDesign({ trim: i })}>{p.name}</Chip>)}
              </Row>
            </>}
          </Step>

          <Step n={4} title="Contract and loan" sum={plan ? (plan.commitment > 0 ? `${plan.lender} · ${Math.round(plan.ltc * 100)}% LTC` : "All equity") : "—"}>
            <Row k="Contract">
              <Chip on={contract === "gmp"} title="Guaranteed maximum price: the builder carries overruns" onClick={() => set({ contract: "gmp" })}>GMP</Chip>
              <Chip on={contract === "costplus"} title="Cheaper, but overruns are yours" onClick={() => set({ contract: "costplus" })}>Cost-plus</Chip>
              <span className="bd-terms bd-inline">{contract === "gmp" ? "Builder carries overruns" : "Cheaper · overruns are yours"}</span>
            </Row>
            {/* THE LENDER (owner, Oct 2026: "you can't choose your lender"): every
                construction desk's terms on this job; one that will not write it says why */}
            {d.quotes.length > 0 && <Row k="Lender">
              {d.quotes.map((q) => (
                <Chip key={q.lender} on={(plan?.lender ?? d.bank) === q.lender} disabled={!q.open || !(q.ltcMax > 0)}
                  title={q.why ?? `${q.lender}: lends up to ${Math.round((lenderMax[q.lender] ?? 0) * 100)}% of this job's cost (loan-to-cost) at ${pct2(q.ratePct)}, ${(q.points * 100).toFixed(1)} pts`}
                  onClick={() => set({ bank: q.lender })}>
                  {q.lender} <span className="bd-sub">{q.open && q.ltcMax > 0 ? `${pct2(q.ratePct)} · ${Math.round((lenderMax[q.lender] ?? 0) * 100)}% max` : "closed"}</span>
                </Chip>))}
            </Row>}
            {/* THE LOAN, ANY AMOUNT (owner): 0 to all the lender offers, in 5% steps of its maximum */}
            <Row k="Loan">
              <input type="range" min={0} max={1} step={0.05} value={d.ltcWant} disabled={!!plan && !(plan.ltcMax > 0)}
                onChange={(e) => set({ ltcWant: +e.target.value })} style={{ flex: 1 }} aria-label="Loan amount" />
              <span className="mono">{plan && plan.ltcMax > 0 ? `${Math.round(plan.ltcMax * d.ltcWant * 100)}% LTC` : "—"}</span>
            </Row>
            {plan && <div className="bd-terms mono">{plan.commitment > 0
              ? `${plan.lender} · ${pct2(plan.ratePct)} · ${Math.round(plan.ltc * 100)}% LTC · ${usd(plan.commitment)} · ${(plan.points * 100).toFixed(1)} pts`
              : plan.ltcMax > 0 ? `All equity · ${plan.lender} offers ${Math.round(plan.ltcMax * 100)}% at ${pct2(plan.ratePct)}` : (plan.lenderNote ?? "No lender quotes")}</div>}
            {/* THE REST OF THE DEBT (owner, Oct 2026: "you should be able to add a rate cap"):
                the takeout hedge, the fees and the loan the building inherits at delivery */}
            <Row k="Rate">
              {(["float", "cap", "fixed"] as const).map((k) => {
                const noLoan = !plan || !(plan.commitment > 0);
                return (
                  <Chip key={k} on={d.takeout === k} disabled={noLoan || (k === "float" && takeoutHedgeRequired(plan))}
                    title={noLoan ? "Take a construction loan to choose how it converts" : k === "float" ? (takeoutHedgeRequired(plan) ? "The lender requires a cap or a lock at this loan size" : "Float at index + spread")
                      : k === "cap" ? "Rate cap: the index is capped 1.5 pts over today's until the mini-perm matures" : "Lock the takeout rate today"}
                    onClick={() => set({ takeout: k })}>
                    {k === "float" ? "Float" : k === "cap" ? "Rate cap" : "Fixed lock"}{!noLoan && <span className="bd-sub"> {k === "float" ? "$0" : usd(takeoutHedgeCost(plan, k))}</span>}
                  </Chip>);
              })}
            </Row>
            {plan && plan.commitment > 0 && (() => {
              const t = takeoutRead(game.econ, plan, d.takeout);
              const x = (v: number) => (Number.isFinite(v) ? `${v.toFixed(2)}×` : "—");
              return <div className="bd-terms mono">
                {`Fee ${usd(plan.pointsCost)} · interest reserve ${usd(plan.interestReserve)} · at delivery ${pct2(t.ratePct)}, DSCR ${x(t.dscr)} (${x(t.dscrStress)} if rates +3)`}
              </div>;
            })()}
          </Step>

          <Partners d={d} bbl={bbl} />
          <Details d={d} />
          {commit && <CommitButton d={d} bbl={bbl} />}
        </div>
      </div>
    </div>
  );
}

/** One numbered step of the desk: a title, what is chosen, and its choices. Open by default. */
function Step({ n, title, sum, children }: { n: number; title: string; sum: React.ReactNode; children: React.ReactNode }) {
  return (
    <details className="bd-step" open>
      <summary><span className="bd-n">{n}</span><span className="bd-t">{title}</span><span className="bd-s">{sum}</span></summary>
      <div className="bd-choices">{children}</div>
    </details>
  );
}

/** Shops at grade, or the mixed-use stack: the programme inside the building. */
function Programme({ d, set }: { d: DeskScheme; set: (p: Partial<DevDraft>) => void }) {
  const { use, floors } = d;
  if (d.product) return null;
  if (use === "office" || use === "multifamily") {
    return <Row k="Shops">
      {(["auto", "on", "off"] as const).map((k) => (
        <Chip key={k} on={d.groundRetail === k} title={k === "auto" ? "The street's footfall and the retail market decide" : k === "on" ? "Shops on the ground floor whatever the street says" : "A lobby and more floor for the main use"}
          onClick={() => set({ groundRetail: k })}>{k === "auto" ? "Street decides" : k === "on" ? "Ground-floor shops" : "No shops"}</Chip>))}
    </Row>;
  }
  if (use !== "mixed") return null;
  const split = d.draft.split ?? { retail: 15, office: 45, multifamily: 40 };
  const retailCap = Math.max(0, Math.floor(maxRetailShare(floors) * 100));
  const nonRetail = Math.max(1, split.office + split.multifamily);
  const officeShare = Math.round((split.office / nonRetail) * 100);
  return <>
    <Row k="Shops">
      <Slider label="Retail" value={Math.min(split.retail, retailCap)} min={0} max={Math.max(1, retailCap)} step={1}
        onChange={(v) => set({ split: { retail: v, office: split.office, multifamily: split.multifamily } })} format={(v) => `${v}% of floor area (most ${retailCap}%)`} />
    </Row>
    <Row k="Upper">
      <Slider label="Office share" value={officeShare} min={0} max={100} step={5}
        onChange={(v) => set({ split: { retail: split.retail, office: v, multifamily: 100 - v } })} format={(v) => `${v}% office · ${100 - v}% homes`} />
    </Row>
  </>;
}

/** THE ANSWER, ALWAYS IN VIEW: what it is worth over what it costs, and the cheque. */
function Verdict({ d }: { d: DeskScheme }) {
  const p = d.plan;
  if (!p) return <div className="bd-verdict bad"><div className="bd-big">—</div><div className="bd-note">{d.bar ?? "No scheme prices here"}</div></div>;
  const tone = p.hurdleRatio >= 1.08 ? "good" : p.hurdleRatio >= 1 ? "warn" : "bad";
  const all = p.equity + p.pointsCost + d.siteDebt;
  return (
    <div className={"bd-verdict " + tone}>
      <div className="bd-cell"><div className="bd-lab">Profit</div><div className={"bd-big mono " + (d.profit < 0 ? "neg" : "pos")}>{d.profit < 0 ? "−" : ""}{usd(Math.abs(d.profit))}</div></div>
      {/* THE BUILD COST BESIDE THE PROFIT (owner, Nov 2026): the construction cost and its $/sf, the same numbers as Numbers → Cost */}
      <div className="bd-cell"><div className="bd-lab">Construction</div><div className="bd-mid mono">{usd(p.costTotal)} <span className="bd-sub">· ${Math.round(p.costTotal / Math.max(1, p.sf))}/sf</span></div></div>
      <div className="bd-cell"><div className="bd-lab">Yield · hurdle</div><div className="bd-mid mono">{pct2(p.yieldOnCost)} · {pct2(p.requiredYield)}</div></div>
      <div className="bd-cell"><div className="bd-lab">Equity</div><div className="bd-mid mono">{usd(all)}</div></div>
      <div className="bd-cell"><div className="bd-lab">Build</div><div className="bd-mid mono">{p.months} mo</div></div>
      {d.short > 0 && <div className="bd-note">Short {usd(d.short)}</div>}
    </div>
  );
}

/**
 * PRE-LEASE AND PARTNERS (owner, Oct 2026: "the build desk seems to be missing
 * some options hidden within the code"): a build-to-suit listing and outside
 * investors. The contract, shops and the mixed stack moved up to their steps;
 * nothing here is folded away any more (owner, Nov 2026: "make sure all
 * available options are shown").
 */
function Partners({ d, bbl }: { d: DeskScheme; bbl: string }) {
  const game = useHeldGame(bbl);
  const parcels = useStore((s) => s.parcels)!;
  const [pitch, setPitch] = useState<PitchStyle>("base");
  const [share, setShare] = useState(1);
  const plan = d.plan;
  const held = game.holdings[bbl];
  const offer = held?.btsOffer;
  const [termY, setTermY] = useState(() => btsTermY(offer?.termY));
  const raise = game.raises?.[bbl];
  const [use, floors, cov, contract, ltc, custom, lender, spec] = d.commitArgs;
  const job: RaiseJob = { use, floors, coverage: cov, contract, ltc, custom, lender, spec, pitch };
  // outside equity: the engine's own limits (syndicate.ts), the site counted at its equity
  const synBar = !held ? "Buy the lot first." : d.purse.fund ? "A fund lot is built with the fund's money." : syndicateBar(game, bbl);
  const landEquity = held ? Math.max(0, ownedHoldingValue(game, parcels, held) - d.siteDebt) : 0;
  const outMax = plan && !synBar ? maxOutside(game, d.need.whole, landEquity) : 0;
  const outside = Math.round(outMax * share / 10_000) * 10_000;
  const pv = plan && outside > 0 ? raisePreview(game, plan, landEquity, d.need.whole, outside, pitch) : null;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <Step n={5} title="Pre-lease and partners" sum={d.prospect ? `Anchor: ${d.prospect.name}` : raise ? "Raising" : offer ? "Listed for a tenant" : "Optional"}>
        {use === "mixed" || d.product ? <Row k="Anchor"><span className="bd-terms bd-inline">Build-to-suit is for a single-use street building</span></Row> : <Row k="Anchor">
          {d.prospect
            ? <><span className="bd-terms" style={{ paddingLeft: 0 }}>{d.prospect.name}</span><Chip on={false} onClick={() => useStore.getState().clearBts(bbl)}>Back to spec</Chip></>
            : <>
              <Slider label="Lease term" value={termY} min={BTS_TERM_MIN_Y} max={BTS_TERM_MAX_Y} step={1} onChange={setTermY} format={(v) => `${v} yrs`} />
              <Chip on={!!offer} title="Lease before building"
                onClick={() => useStore.getState().proposeBts(bbl, use, floors, cov, termY)}>{offer ? "Update listing" : "List"}</Chip>
              {offer && <Chip on={false} onClick={() => useStore.getState().clearBts(bbl)}>Pull</Chip>}
            </>}
        </Row>}
        <Row k="Investors">
          {raise
            ? <>
              <span className="bd-terms mono" style={{ paddingLeft: 0 }}>Raising {usd(committedTotal(raise))} of {usd(raise.target)}</span>
              <Chip on={false} disabled={committedTotal(raise) < raise.target / 2} title="Needs half raised" onClick={() => useStore.getState().closeRaiseNow(bbl)}>Close now</Chip>
              <Chip on={false} onClick={() => useStore.getState().cancelRaise(bbl)}>Cancel</Chip>
            </>
            : synBar || !plan || !(outMax > 0)
              ? <span className="bd-terms" style={{ paddingLeft: 0 }}>{synBar ?? "No outside equity available"}</span>
              : <>
                <Slider label="Raise" value={share} min={0} max={1} step={0.1} onChange={setShare} format={() => `${usd(outside)} of ${usd(outMax)}`} />
                {(["conservative", "base", "aggressive"] as const).map((k) => (
                  <Chip key={k} on={pitch === k} title="Promised investor return" onClick={() => setPitch(k)}>{k === "conservative" ? "Low pitch" : k === "base" ? "Base" : "High pitch"}</Chip>))}
              </>}
        </Row>
        {!raise && pv && <div className="bd-terms mono">
          {`Promise ${pct(pv.pitchIrr)} · fills ${pct(pv.odds.full)} · small ${pct(pv.odds.small)} · fails ${pct(pv.odds.fail)} · ~${Math.round(pv.odds.months)} mo`}
        </div>}
        {!raise && outside > 0 && (pv && pv.pitchIrr <= 0
          // investors do not fund a projected loss (raise.ts raiseQuote): say so before the click
          ? <div className="bd-warn">Loss {pct(pv.pitchIrr)}/yr · <b>unfundable</b></div>
          : <div className="bd-v" style={{ paddingLeft: 60 }}>
            <button type="button" className="btn" onClick={() => useStore.getState().launchRaise(bbl, job, outside)}>Open raise · {usd(outside)}</button>
            <button type="button" className="btn btn-buy" onClick={() => useStore.getState().raiseAndBuild(bbl, job, outside)}>Raise and build</button>
          </div>)}
    </Step>
  );
}

/** One disclosure for the numbers behind the verdict. */
function Details({ d }: { d: DeskScheme }) {
  const p = d.plan;
  const game = useStore((s) => s.game);
  if (!p || !game) return null;
  const st = p.product?.site;
  // THE TWO MARKET PRICES A SCHEME IS BUILT FROM, each with its chain (whyReads.ts).
  const why: Record<string, React.ReactNode> = {
    Cost: <WhyButton id={costWhy(game)} lead={`Cost ${usd(p.costTotal)} at the town's construction index ${(game.econ.costIdx ?? 1).toFixed(2)}`} />,
    Land: <WhyButton id={landWhy(game)} />,
  };
  const rows: [string, string][] = [
    ["Building", `${sf(p.sf)} · ${p.floors} fl · FAR ${p.far} of ${p.farMax.toFixed(1)}`],
    ["Cost", `${usd(p.costTotal)} · $${Math.round(p.costTotal / Math.max(1, p.sf))}/sf`],
    ["Land", usd(p.landBasis)],
    ["All in", usd(p.basisTotal)],
    ["Worth", `${usd(d.worth)} · ${pct2(p.exitYield)} exit`],
    ["NOI", usd(p.stabNoi)],
    ["At close", usd(d.need.dayOne)],
    ["Cushion", usd(d.need.margin)],
    ...(d.siteDebt > 0 ? [["Land loan", usd(d.siteDebt)] as [string, string]] : []),
    ...(st ? [["Site", `${st.stalls} stalls${st.doors ? ` · ${st.doors} doors` : ""} · ${Math.round((st.gsf / Math.max(1, d.rec.lotArea)) * 100)}% built`] as [string, string]] : []),
  ];
  return (
    <details className="bd-details" open>
      <summary>Numbers</summary>
      <table className="bd-kv"><tbody>
        {rows.map(([k, v]) => <tr key={k}><td>{k}{why[k] && <> {why[k]}</>}</td><td className="mono">{v}</td></tr>)}
      </tbody></table>
    </details>
  );
}

/** Break ground on the scheme the desk shows (deskScheme.commitArgs). */
export function breakGround(d: DeskScheme, bbl: string) {
  const [use, floors, cov, contract, ltc, custom, lender, spec] = d.commitArgs;
  useStore.getState().develop(bbl, use, floors, cov, contract, ltc, custom, lender, spec);
}

function CommitButton({ d, bbl }: { d: DeskScheme; bbl: string }) {
  const all = d.plan ? d.plan.equity + d.plan.pointsCost + d.siteDebt : 0;
  return (
    <button type="button" className="btn btn-buy bd-commit" disabled={!!d.why} title={d.why ?? undefined} onClick={() => breakGround(d, bbl)}>
      {d.why ?? `Break ground · ${usd(all)}`}
    </button>
  );
}

/** The scheme in a few words, for a footer or a card. */
export function schemeName(d: DeskScheme): string {
  return d.product ? d.product.short : `${devUseLabel(d.use)} · ${d.floors} fl`;
}

