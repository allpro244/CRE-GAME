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
import { planDevelopment, takeoutHedgeCost, takeoutHedgeRequired, takeoutRead, maxRetailShare, BTS_TERM_MIN_Y, BTS_TERM_MAX_Y, btsTermY } from "@/engine/dev";
import { maxOutside, syndicateBar } from "@/engine/syndicate";
import { raisePreview, type RaiseJob } from "@/engine/raise";
import { committedTotal, type PitchStyle } from "@/engine/investors";
import { ownedHoldingValue } from "@/engine/value";
import { BUILD_TIERS, buildTier } from "@/engine/value";
import { START_YEAR, type DevDraft, type DevUse } from "@/engine/types";
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
  const setUse = (u: DevUse) => {
    const fl = Math.max(1, floors);
    const { form: _f, formRetained: _r, formSkin: _s, ...look } = design;
    set({ use: u, product: undefined, floors: fl, cov: coverFor(rec, u, fl), design: look });
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
  const bases = BASES.filter((b) => floors >= b.minFloors && (!shops || b.shops));
  const tops = [
    ...ROOF_CHOICES.filter((r) => floors <= r.maxFloors && !(r.key === "flat" && floors >= CROWN_MIN_FLOORS))
      .map((r) => ({ id: `roof:${r.key}`, name: r.name, patch: { roof: r.key, crown: undefined, signature: undefined } as Partial<BuildingDesign> })),
    ...(floors >= CROWN_MIN_FLOORS ? CROWN_CHOICES : [])
      .map((c) => ({ id: `crown:${c.key}`, name: c.name, patch: { crown: c.key, roof: undefined, signature: undefined } as Partial<BuildingDesign> })),
  ];
  const topNow = design.signature ? "signature" : design.crown ? `crown:${design.crown}` : design.roof ? `roof:${design.roof}` : "auto";
  const landmarks = floors >= SIGNATURE_MIN_FLOORS ? SIGNATURE_FORMS.filter((f) => floors >= f.minFloors && year >= f.from) : [];

  return (
    <div className="deal deal-wide build-desk">
      <Verdict d={d} />
      <div className="bd-grid">
        <div className="bd-model">
          <SchemeViewer height={UNREAL_HOST ? 300 : 260} />
        </div>
        <div className="bd-choices">
          {starts.length > 0 && (
            <Row k="Best">
              {starts.map((s) => {
                const on = s.use === use && (s.product ? s.product === d.product?.key : !d.product && s.floors === floors);
                return (
                  <Chip key={s.use + s.floors + (s.product ?? "")} on={on}
                    onClick={() => set(s.product ? { use: s.use, product: s.product } : { use: s.use, product: undefined, floors: s.floors, cov: coverFor(rec, s.use, s.floors) })}>
                    {s.product ? productName(s.product) : `${devUseLabel(s.use)} ${s.floors}`}<span className="bd-sub"> {ratio(s.hurdle)}</span>
                  </Chip>
                );
              })}
            </Row>
          )}
          <Row k="Use">
            {[...new Set([...d.legal, use])].map((u) => (
              <Chip key={u} on={u === use} onClick={() => setUse(u)} disabled={!d.legal.includes(u) && u !== use}>{devUseLabel(u)}</Chip>
            ))}
          </Row>
          {d.bar && <div className="bd-warn">{d.bar}</div>}
          {d.prods.length > 0 && (
            <Row k="Type">
              <Chip on={!d.product} onClick={() => set({ product: undefined })}>Street</Chip>
              {d.prods.map((p) => (
                <Chip key={p.key} on={d.product?.key === p.key} title={p.label} onClick={() => set({ product: p.key })}>{p.short}</Chip>
              ))}
            </Row>
          )}
          {!d.product && (
            <Row k="Size">
              <Slider label="Floors" value={floors} min={1} max={Math.max(1, d.top)} step={1} onChange={setSize}
                format={() => `${floors} fl${plan ? ` · ${sf(plan.sf)} · ${Math.round(cov * 100)}% lot` : ""}`} />
            </Row>
          )}
          {/* THE ENVELOPE IS FULL (owner: "the sqft stops growing"): past the
              district's FAR more floors only slim the floorplate; the way out is a FAR filing */}
          {!d.product && plan && plan.far >= plan.farMax - 0.05 && <div className="bd-terms">
            FAR max {plan.farMax.toFixed(1)} · <span className="mono">plate shrinks</span> ·{" "}
            <button type="button" className="bd-link" onClick={() => {
              useStore.getState().openProperty(bbl, "summary");
              window.setTimeout(() => useStore.setState({ pageJump: "Zoning variance" }), 120);
            }}>Seek more FAR</button>
          </div>}
          <Row k="Tier">
            {BUILD_TIERS.map((t) => (
              <Chip key={t.key} on={tier.key === t.key} title={t.blurb} onClick={() => set({ spec: t.spec })}>{t.label}</Chip>
            ))}
          </Row>
          {forms.length > 0 && (
            <Row k="Form">
              <Chip on={!design.form} onClick={() => set({ design: { ...design, form: undefined, formRetained: undefined, formSkin: undefined } })}>Block</Chip>
              {forms.map((f) => (
                <Chip key={f.key} on={design.form === f.key} title={f.blurb}
                  onClick={() => set({ design: { ...design, form: f.key, formRetained: f.retained, formSkin: f.skin } })}>
                  {f.name}<span className="bd-sub"> {Math.round((f.retained - 1) * 100)}%</span>
                </Chip>
              ))}
            </Row>
          )}
          {/* THE FULL CATALOGUE (owner): every facade, one category at a time — "Street" lets the block choose */}
          <Row k="Look">
            <Chip on={!design.kit && !design.facade} onClick={() => pickLook(LOOKS[0])}>Street</Chip>
            {UNREAL_HOST
              ? KIT_GROUPS.map((g) => <Chip key={g.key} tab on={lookEra === g.key} onClick={() => setLookEra(g.key)}>{g.name}</Chip>)
              : groups.map((g) => <Chip key={g.key} tab on={groupNow === g.key} onClick={() => setLookGroup(g.key)}>{g.name}</Chip>)}
          </Row>
          <Row k="">
            {UNREAL_HOST
              ? KITS.filter((k) => k.group === lookEra).map((k) => (
                <Chip key={k.key} on={design.kit === k.key} title={k.era}
                  onClick={() => { const { kit: _k, facade: _f, kitColour: _c, ground: _g, top: _t, bays: _b, ...rest } = design; set({ design: { ...rest, kit: k.key, facade: k.family } }); }}>{k.name}</Chip>))
              : styles.filter((f) => f.group === groupNow).map((f) => (
                <Chip key={f.key} on={design.facade?.split("#")[0] === f.key} title={f.era}
                  onClick={() => { const { kit: _k, facade: _f, kitColour: _c, ground: _g, top: _t, bays: _b, ...rest } = design; set({ design: { ...rest, facade: f.key } }); }}>{f.name}</Chip>))}
          </Row>
          {!UNREAL_HOST && !d.product && <>
            {styleNow && styleNow.variants.length > 1 && <Row k="Colour">
              {styleNow.variants.map((v, i) => (
                <Chip key={v} on={variantNow === i} onClick={() => setDesign({ facade: i ? `${styleNow.key}#${i}` : styleNow.key })}>{v}</Chip>
              ))}
            </Row>}
            <Row k="Ground">
              <Chip on={!design.base} onClick={() => setDesign({ base: undefined })}>{shops ? "Shopfronts" : "Auto"}</Chip>
              {bases.map((b) => <Chip key={b.key} on={design.base === b.key} title={b.blurb} onClick={() => setDesign({ base: b.key })}>{b.name}</Chip>)}
            </Row>
            <Row k="Top">
              <Chip on={topNow === "auto"} onClick={() => setDesign({ roof: undefined, crown: undefined, signature: undefined })}>Auto</Chip>
              {tops.map((o) => <Chip key={o.id} on={topNow === o.id} onClick={() => setDesign(o.patch)}>{o.name}</Chip>)}
            </Row>
            {landmarks.length > 0 && <Row k="Landmark">
              <Chip on={!design.signature} onClick={() => setDesign({ signature: undefined })}>None</Chip>
              {landmarks.map((f) => <Chip key={f.key} on={design.signature === f.key} title={f.blurb}
                onClick={() => setDesign({ signature: f.key, crown: undefined, roof: undefined })}>{f.name}</Chip>)}
            </Row>}
            <Row k="Trim">
              <Chip on={design.trim === undefined} onClick={() => setDesign({ trim: undefined })}>Auto</Chip>
              {TRIM_PAINTS.map((p, i) => <Chip key={p.name} on={design.trim === i} onClick={() => setDesign({ trim: i })}>{p.name}</Chip>)}
            </Row>
          </>}
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
          {plan && plan.commitment > 0 && <>
            <Row k="Rate">
              {(["float", "cap", "fixed"] as const).map((k) => (
                <Chip key={k} on={d.takeout === k} disabled={k === "float" && takeoutHedgeRequired(plan)}
                  title={k === "float" ? (takeoutHedgeRequired(plan) ? "The lender requires a cap or a lock at this loan size" : "Float at index + spread")
                    : k === "cap" ? "Rate cap: the index is capped 1.5 pts over today's until the mini-perm matures" : "Lock the takeout rate today"}
                  onClick={() => set({ takeout: k })}>
                  {k === "float" ? "Float" : k === "cap" ? "Rate cap" : "Fixed lock"}<span className="bd-sub"> {k === "float" ? "$0" : usd(takeoutHedgeCost(plan, k))}</span>
                </Chip>))}
            </Row>
            {(() => {
              const t = takeoutRead(game.econ, plan, d.takeout);
              const x = (v: number) => (Number.isFinite(v) ? `${v.toFixed(2)}×` : "—");
              return <div className="bd-terms mono">
                {`Fee ${usd(plan.pointsCost)} · interest reserve ${usd(plan.interestReserve)} · at delivery ${pct2(t.ratePct)}, DSCR ${x(t.dscr)} (${x(t.dscrStress)} if rates +3)`}
              </div>;
            })()}
          </>}
          {d.prospect && <div className="bd-terms">Anchor: {d.prospect.name}</div>}
          <More d={d} bbl={bbl} set={set} />
          <Details d={d} />
          {commit && <CommitButton d={d} bbl={bbl} />}
        </div>
      </div>
    </div>
  );
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
      <div className="bd-cell"><div className="bd-lab">Yield · hurdle</div><div className="bd-mid mono">{pct2(p.yieldOnCost)} · {pct2(p.requiredYield)}</div></div>
      <div className="bd-cell"><div className="bd-lab">Equity</div><div className="bd-mid mono">{usd(all)}</div></div>
      <div className="bd-cell"><div className="bd-lab">Build</div><div className="bd-mid mono">{p.months} mo</div></div>
      {d.short > 0 && <div className="bd-note">Short {usd(d.short)}</div>}
    </div>
  );
}

/**
 * MORE (owner, Oct 2026: "the build desk seems to be missing some options
 * hidden within the code"). What the engine takes and the simple desk had
 * dropped: the contract, the rate hedge, shops at grade, the mixed stack, a
 * build-to-suit listing and outside investors. Closed until opened.
 */
function More({ d, bbl, set }: { d: DeskScheme; bbl: string; set: (p: Partial<DevDraft>) => void }) {
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
  const split = d.draft.split ?? { retail: 15, office: 45, multifamily: 40 };
  const retailCap = Math.max(0, Math.floor(maxRetailShare(floors) * 100));
  const nonRetail = Math.max(1, split.office + split.multifamily);
  const officeShare = Math.round((split.office / nonRetail) * 100);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <details className="bd-details">
      <summary>More</summary>
      <div className="bd-choices" style={{ marginTop: 6 }}>
        <Row k="Contract">
          <Chip on={contract === "gmp"} title="Builder carries overruns" onClick={() => set({ contract: "gmp" })}>GMP</Chip>
          <Chip on={contract === "costplus"} title="Cheaper; overruns yours" onClick={() => set({ contract: "costplus" })}>Cost-plus</Chip>
        </Row>
        {(use === "office" || use === "multifamily") && !d.product && <Row k="Shops">
          {(["auto", "on", "off"] as const).map((k) => (
            <Chip key={k} on={d.groundRetail === k} onClick={() => set({ groundRetail: k })}>{k === "auto" ? "Auto" : k === "on" ? "Ground floor" : "None"}</Chip>))}
        </Row>}
        {use === "mixed" && <>
          <Row k="Shops">
            <Slider label="Retail" value={Math.min(split.retail, retailCap)} min={0} max={Math.max(1, retailCap)} step={1}
              onChange={(v) => set({ split: { retail: v, office: split.office, multifamily: split.multifamily } })} format={(v) => `${v}%`} />
          </Row>
          <Row k="Upper">
            <Slider label="Office share" value={officeShare} min={0} max={100} step={5}
              onChange={(v) => set({ split: { retail: split.retail, office: v, multifamily: 100 - v } })} format={(v) => `${v}% office · ${100 - v}% homes`} />
          </Row>
        </>}
        {use !== "mixed" && !d.product && <Row k="Anchor">
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
      </div>
    </details>
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

