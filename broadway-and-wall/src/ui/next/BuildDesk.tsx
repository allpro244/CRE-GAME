/**
 * THE BUILD DESK, SIMPLE (owner, Oct 2026: "simplified much more … give the
 * player control, though much simpler and refined"). Five choices and a live
 * verdict, on one page:
 *
 *   Use     what the district hosts, and a product where the lot carries one
 *   Size    one dial: storeys, at the widest footprint that height allows
 *   Tier    the four build qualities (BUILD_TIERS)
 *   Look    a form the lot takes (Unreal) and a facade from a short list
 *   Loan    none, half or all the construction lender offers, terms shown
 *
 * The verdict — profit, yield against the hurdle, the cheque — is the
 * engine's own (scheme.ts deskScheme → planDevelopment), and so is the
 * footer's Break ground, which reads the same scheme. The model is the
 * building itself (SchemeViewer), redrawn on every choice.
 */
import { useEffect, useMemo } from "react";
import { useStore } from "@/state/store";
import { useHeldGame } from "@/ui/heldGame";
import Slider from "@/ui/Slider";
import SchemeViewer from "@/ui/panels/SchemeViewer";
import { dominantOf } from "@/engine/proforma";
import { BUILD_TIERS, buildTier } from "@/engine/value";
import { START_YEAR, type DevDraft, type DevUse } from "@/engine/types";
import { KITS } from "@/engine/renderView";
import { FACADE_STYLES } from "@/map/real/RealCity";
import { UNREAL_HOST, formsForLot } from "@/state/unrealHost";
import { usd, sf } from "@/ui/format";
import { devUseLabel } from "@/ui/panels/shared";
import { deskScheme, bestStarts, coverFor, LEVERAGE, productName, type DeskScheme } from "./scheme";
import "./desks.css";

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
const LEV_LABEL = ["None", "Half", "Max"];

// the sweep is a hundred pro formas: once per lot per month
const STARTS = new Map<string, ReturnType<typeof bestStarts>>();

function Chip({ on, onClick, children, title, disabled }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string; disabled?: boolean }) {
  return (
    <button type="button" className={"bd-chip" + (on ? " on" : "")} onClick={onClick} title={title} disabled={disabled} aria-pressed={on}>
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
  const forms = useMemo(() => (UNREAL_HOST && !d.product ? formsForLot(bbl, floors, cov, cls, year) : []),
    [bbl, floors, cov, cls, year, d.product]);
  const formNow = design.form ? forms.find((f) => f.key === design.form) : undefined;
  useEffect(() => {
    // a form the lot no longer takes goes; one it still takes is re-measured
    if (!design.form || !UNREAL_HOST) return;
    if (!formNow) set({ design: { ...design, form: undefined, formRetained: undefined, formSkin: undefined } });
    else if (Math.abs((design.formRetained ?? 1) - formNow.retained) > 0.005 || Math.abs((design.formSkin ?? 1) - formNow.skin) > 0.005)
      set({ design: { ...design, formRetained: formNow.retained, formSkin: formNow.skin } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forms, design.form]);

  const looks = LOOKS.filter((l) => UNREAL_HOST ? !l.kit || KITS.some((k) => k.key === l.kit)
    : !l.facade || (FACADE_STYLES.find((f) => f.key === l.facade)?.maxFloors ?? 0) >= floors);
  const lookOn = (l: (typeof LOOKS)[number]) => !l.kit
    ? !design.kit && !design.facade
    : UNREAL_HOST ? design.kit === l.kit : design.facade?.split("#")[0] === l.facade;
  const pickLook = (l: (typeof LOOKS)[number]) => {
    const { kit: _k, facade: _f, kitColour: _c, ground: _g, top: _t, bays: _b, ...rest } = design;
    const kit = KITS.find((k) => k.key === l.kit);
    set({ design: !l.kit ? rest : UNREAL_HOST && kit ? { ...rest, kit: kit.key, facade: kit.family } : { ...rest, facade: l.facade } });
  };
  const tier = buildTier(d.spec);

  return (
    <div className="deal build-desk">
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
          <Row k="Look">
            {looks.map((l) => (
              <Chip key={l.id} on={lookOn(l)} onClick={() => pickLook(l)}>{l.label}</Chip>
            ))}
          </Row>
          <Row k="Loan">
            {LEVERAGE.map((v, i) => (
              <Chip key={v} on={Math.abs(d.ltcWant - v) < 1e-9} onClick={() => set({ ltcWant: v })}
                disabled={!!plan && !(plan.ltcMax > 0) && v > 0}>{LEV_LABEL[i]}</Chip>
            ))}
          </Row>
          {plan && <div className="bd-terms mono">{plan.commitment > 0
            ? `${plan.lender} · ${pct2(plan.ratePct)} · ${Math.round(plan.ltc * 100)}% LTC · ${usd(plan.commitment)} · ${(plan.points * 100).toFixed(1)} pts`
            : plan.ltcMax > 0 ? `All equity · ${plan.lender} offers ${Math.round(plan.ltcMax * 100)}% at ${pct2(plan.ratePct)}` : (plan.lenderNote ?? "No lender quotes")}</div>}
          {d.prospect && <div className="bd-terms">Anchor: {d.prospect.name}</div>}
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

/** One disclosure for the numbers behind the verdict. */
function Details({ d }: { d: DeskScheme }) {
  const p = d.plan;
  if (!p) return null;
  const st = p.product?.site;
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
    <details className="bd-details">
      <summary>Numbers</summary>
      <table className="bd-kv"><tbody>
        {rows.map(([k, v]) => <tr key={k}><td>{k}</td><td className="mono">{v}</td></tr>)}
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

