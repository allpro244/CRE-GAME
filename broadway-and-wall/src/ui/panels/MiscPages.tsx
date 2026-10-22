import { useEffect, useState } from "react";
import { InterfaceSwitch } from "@/ui/next/InterfaceSwitch";
import { useStore } from "@/state/store";
import { monthLabel } from "@/engine/types";
import type { GameState } from "@/engine/types";
import { usd } from "@/ui/format";
import { soundOn, setSoundOn, play } from "@/ui/Sounds";
import { pendingTerm, glossId, glossaryEntries } from "@/ui/Glossary";
import { Row } from "@/ui/panels/shared";
import { themePref, setThemePref, type ThemePref } from "@/ui/theme";
import { CLOCK_OPTIONS, describeSetup } from "@/engine/setup";
import { UNREAL_HOST } from "@/state/unrealHost";
import { GFX_PRESETS, presetOf, type GfxOptions, type GfxPreset } from "@/state/graphics";

export function PrimerPage() {
  const game = useStore((s) => s.game)!;
  const cap = game.econ.capRate.office;
  // A round, legible example building priced off the market the player is
  // actually in, so every number on this page reconciles with the tape.
  const noi = 1_000_000;
  const value = Math.round(noi / (cap / 100));
  return (
    <div className="primer-prose">
      <div className="hint">
        If you have never bought a building, this page is the whole vocabulary. Everything else in the game
        assumes it. It takes about two minutes and the numbers in it are today's, from your own market.
      </div>

      <div className="page-section">1 · NOI — what the building earns</div>
      <div className="hint">
        <b>Net operating income</b> is the rent the building collects in a year, minus what it costs to run —
        taxes, insurance, repairs, management, the lights in the lobby. It does <b>not</b> subtract the mortgage.
        That is the whole trick of the number: NOI describes the <i>building</i>, so two buyers with different
        loans can look at the same one and agree on what it earns. Your mortgage is your problem, not the
        building's.
        <br /><br />
        A building letting {usd(1_400_000)} of rent a year that costs {usd(400_000)} to run has an NOI
        of <b>{usd(noi)}</b>.
      </div>

      <div className="page-section">2 · Cap rate — the yield you buy it at</div>
      <div className="hint">
        The <b>capitalisation rate</b> is one year's NOI divided by the price. Nothing more.
        <br /><br />
        <span className="mono">cap rate = NOI ÷ price</span>
        <br /><br />
        Buy that {usd(noi)} building for {usd(value)} and you are buying a{" "}
        <b>{cap.toFixed(2)}% cap</b> — the yield your money earns in year one if nothing changes.
        Office in this city trades at about {cap.toFixed(2)}% today, and you can watch that move on the Economy
        page.
        <br /><br />
        <b>A LOW cap rate means an EXPENSIVE building.</b> That is the part everybody gets backwards at first.
        Paying less for the same income is a higher yield, so cheap buildings have high cap rates. When you hear
        that "cap rates compressed", prices went up.
        <br /><br />
        Cap rates are high where the income is risky — an old building, a weak street, one tenant with three
        years left — and low where it is safe. So the cap rate you are quoted is the market telling you what it
        thinks of your building, in one number.
      </div>

      <div className="page-section">3 · Appraisal — somebody's opinion of the price</div>
      <div className="hint">
        An <b>appraisal</b> is a professional estimate of what a building would sell for. Mostly it is the sum
        above run backwards: take the NOI, pick the cap rate the market is paying for buildings like this one,
        and divide.
        <br /><br />
        <span className="mono">value = NOI ÷ cap rate</span>
        <br /><br />
        It is an <b>opinion, not a price</b>. The price is what somebody actually pays, and the two differ all
        the time. The game shows you an appraisal on every building and an ask next to it; the gap between them
        is most of what there is to read. Lenders care because they lend against the appraisal, so it decides
        how much you can borrow.
      </div>

      <div className="page-section">The two traps</div>
      <div className="hint">
        <b>A high cap rate is not a bargain.</b> It is a warning that somebody else looked and passed. Find out
        what they saw — the roll, the lease expiries, the condition — before you decide you are cleverer.
        <br /><br />
        <b>Debt cuts both ways.</b> Borrowing at 6% to buy a 8% yield makes money, and the same loan against a
        building whose tenants leave will take the building. That is what most of the failures in this game are.
      </div>

      <div className="page-section">The words you will meet next</div>
      <div className="grid">
        <Row k="Occupancy" v="How much of the building is let. The rest earns nothing and still costs you." />
        <Row k="Rent roll" v="The list of who is in the building, what they pay, and when they can leave." />
        <Row k="LTV" v="Loan to value — the share of the price the lender put up." />
        <Row k="DSCR" v="NOI divided by the loan payments. Under 1.0 the building cannot pay its own mortgage." />
        <Row k="Yield on cost" v="NOI ÷ what it cost you to build it. The developer's version of a cap rate." />
        <Row k="Lease-up" v="The months between opening an empty building and filling it. Nobody's favourite." />
      </div>
      <div className="hint">
        That is the vocabulary. Everything else the game will teach you by charging you for it.
      </div>
      <PrimerGlossary />
    </div>
  );
}

/**
 * EVERY UNDERLINED WORD, IN ONE PLACE. A dotted word anywhere in the game
 * opens the Primer; it used to open it at the top, a page away from the word.
 * It now lands here, on the entry, lit for a moment.
 */
function PrimerGlossary() {
  const [lit, setLit] = useState<string | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const go = () => {
      const k = pendingTerm.key;
      if (!k) return;
      pendingTerm.key = null;
      const el = document.getElementById(glossId(k));
      if (!el) return;
      el.scrollIntoView({ block: "center" });
      setLit(glossId(k));
      if (t) clearTimeout(t);
      t = setTimeout(() => setLit(null), 2200);
    };
    go();
    window.addEventListener("bw:gloss", go);
    return () => { window.removeEventListener("bw:gloss", go); if (t) clearTimeout(t); };
  }, []);
  return (
    <>
      <div className="page-section">Glossary — every underlined word</div>
      <div className="gloss-list">
        {glossaryEntries().map((e) => (
          <div key={e.key} id={glossId(e.key)} className={"gloss-entry" + (lit === glossId(e.key) ? " gloss-lit" : "")}>
            <span className="gloss-key">{e.key}</span>
            <span className="gloss-def">{e.def}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * One setting: the switch on the left, what it does on the right, on every
 * row. It was declared inside SettingsPage, so each render made a new
 * component type and React remounted the row — the button lost keyboard focus
 * the moment you pressed it — and .modal-actions wrapped the long rows so the
 * switch sat above its label on some rows and beside it on others.
 */
function Toggle({ on, set, label, detail, more }: { on: boolean; set: (v: boolean) => void; label: string; detail: string; more?: string }) {
  return (
    <div className="deal setting-row">
      {/* A SWITCH, NOT A BUTTON THAT SAYS A WORD. "Off" on a button reads
          as either the state or the action, and the two mean opposite things. */}
      <button type="button" role="switch" className={"switch" + (on ? " on" : "")} aria-checked={on} aria-label={label} onClick={() => set(!on)}>
        <span className="switch-track" aria-hidden="true"><span className="switch-knob" /></span>
        <span className="switch-word">{on ? "On" : "Off"}</span>
      </button>
      <div className="setting-text">
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div className="hint" style={{ margin: 0 }}>{detail}</div>
        {/* A ONE-LINE ANSWER, THEN THE FINE PRINT. Two of these ran to ninety
            words each; the switch should say what it does before it says
            everything it touches. */}
        {more && (
          <details className="setting-more">
            <summary>More</summary>
            <div className="hint" style={{ margin: "4px 0 0" }}>{more}</div>
          </details>
        )}
      </div>
    </div>
  );
}

function ThemePicker() {
  const [pref, setPref] = useState<ThemePref>(themePref());
  const opts: [ThemePref, string][] = [["light", "Light"], ["dark", "Dark"], ["system", "Match system"]];
  return (
    <div className="setting-row">
      <div className="setting-text">
        <div style={{ fontWeight: 600 }}>Appearance</div>
        <div className="hint" style={{ padding: 0 }}>The desks and cards; the city keeps its own light.</div>
      </div>
      <div className="seg" role="radiogroup" aria-label="Appearance">
        {opts.map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={pref === v}
            className={"seg-btn" + (pref === v ? " on" : "")}
            onClick={() => { setThemePref(v); setPref(v); }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SettingsPage() {
  const game = useStore((s) => s.game)!;
  const popupsOff = useStore((s) => s.popupsOff);
  const hoverCard = useStore((s) => s.hoverCard);
  const setHoverCard = useStore((s) => s.setHoverCard);
  const [sound, setSound] = useState(soundOn());
  const setPopupsOff = useStore((s) => s.setPopupsOff);
  const alertsOff = useStore((s) => s.alertsOff);
  const mutedAlerts = useStore((s) => s.mutedAlerts);
  const muteAlertKind = useStore((s) => s.muteAlertKind);
  const setAlertsOff = useStore((s) => s.setAlertsOff);
  const fpsOn = useStore((s) => s.fpsOn);
  const setFpsOn = useStore((s) => s.setFpsOn);
  const graphics = useStore((s) => s.graphics);
  const setGraphics = useStore((s) => s.setGraphics);
  const flip = (patch: Partial<GameState>) => {
    const st = useStore.getState();
    useStore.setState({ game: { ...st.game!, ...patch } });
  };
  // "money" is the retired name of today's default (stopRule).
  const clockMode = !game.clockStops || game.clockStops === "money" ? "decisions" : game.clockStops;
  return (
    <div>
      <InterfaceSwitch />
      <ThemePicker />
      <Toggle
        on={sound}
        set={(v) => { setSoundOn(v); setSound(v); if (v) play("milestone"); }}
        label="Sounds"
        detail="A soft bell on a milestone, a delivery, a sale and a year closing; a low note on an error. Synthesised, quiet, never on the monthly tick."
      />
      <div className="page-section">Interruptions</div>
      {/* THE CLOCK, as chosen on the setup page — editable here for the life
          of the campaign. See stopRule in engine/sim.ts. */}
      <div className="setting-row">
        <div className="setting-text">
          <div style={{ fontWeight: 600 }}>What stops Yr / Skip / Play</div>
          <div className="hint" style={{ padding: 0 }}>{CLOCK_OPTIONS.find((c) => c.id === clockMode)?.note}</div>
        </div>
        <div className="seg" role="radiogroup" aria-label="What stops the clock">
          {CLOCK_OPTIONS.map((c) => {
            const on = clockMode === c.id;
            return (
              <button key={c.id} type="button" role="radio" aria-checked={on} title={c.note}
                className={"seg-btn" + (on ? " on" : "")}
                onClick={() => flip({ clockStops: c.id === "decisions" ? undefined : c.id })}>{c.label}</button>
            );
          })}
        </div>
      </div>
      {clockMode !== "decisions" && <Toggle
        on={game.brokerStops !== "never"}
        set={(v) => flip({ brokerStops: v ? undefined : "never" })}
        label="Broker first looks stop the clock"
        detail="On, Yr / Skip / Play stop when a broker's private window on a building is about to lapse — only for buildings you could fund at a typical 65% loan. Off, they wait on the Marketplace, marked FIRST LOOK."
      />}
      <Toggle
        on={!popupsOff}
        set={(v) => setPopupsOff(!v)}
        label="Pop-up cards"
        detail="Letters, offers, bid lists and the auction take the screen when they arrive. Off, they wait on Deals — nothing is lost but the interruption."
        more={"Covers letters of intent, quiet offers and marketed bid lists on buildings you are selling, portfolio indications and the auction card. "
          + "Off, they wait on Deals (watch the badge) and on the property desk — not on Portfolio, which only shows that a deed is listed. "
          + "Turn this off to simulate long stretches. Bid lists on your sales, portfolio indications and a ground tenant's default "
          + "are stop-everything cards — the switch below governs those."}
      />
      <Toggle
        on={!alertsOff}
        set={(v) => setAlertsOff(!v)}
        label="Stop-everything cards"
        detail="Bids on a sale you listed, an indication on a book you put up, and your ground tenant's default take the screen. Off, you read them on Deals and News instead. Black swans and the central bank's big moves — a turn of the cycle, half a point or more, a new chair — always stop the game, whatever this says; routine quarter-point steps are in the news — and a single kind can be muted from its own card instead."
        more={"Bank failures, economy-wide events and a competitor's book taken back pass as a line at the top of the screen and do not stop play, "
          + "unless the clock is set to stop for opportunities too or for everything. "
          + "Each is written into the news feed the moment it fires, so turning this off loses the interruption and not the event. "
          + "A lender taking a competitor's whole book puts the package on Marketplace under Books for sale. "
          + "With both switches off a sale or portfolio bid still stops Year/Skip and badges Deals, but will not take the screen — "
          + "and a quiet offer lapses in two months, a bid list in fourteen, a portfolio indication in three, if you never open the desk."}
      />
      {mutedAlerts.length > 0 && (
        <div className="hint" style={{ margin: "4px 0 10px" }}>
          Not stopping you for: {mutedAlerts.map((k, i) => (
            <span key={k}>{i > 0 ? " · " : ""}{({ bank: "bank failures", portfolio: "books and portfolio offers", ground: "ground-lease defaults", sale: "bid lists on your sales", fed: "central-bank news", delivered: "deliveries" } as Record<string, string>)[k] ?? k}{" "}
              <button type="button" className="linkish" onClick={() => muteAlertKind(k, false)}>(stop me again)</button></span>
          ))}. Black swans and the central bank's big moves always stop the game.
        </div>
      )}
      <Toggle
        on={!game.brokersOff}
        set={(v) => flip({ brokersOff: !v })}
        label="Brokers ring you"
        detail="Off-market deals arrive by phone a few times a year once the street knows your name. Off, the phones stay silent entirely — nothing arrives, on any page."
      />
      <Toggle
        on={!game.auctionQuiet}
        set={(v) => flip({ auctionQuiet: !v })}
        label="The July auction card"
        detail="The county docket comes up as a card when it is published each July — when one of the lots is your own building, or when the clock is set to stop for opportunities. Off, the auction still runs on the same day with the same lots — you read it on Marketplace instead."
      />
      {/* the two renderer switches were filed under Interruptions */}
      <div className="page-section">Display</div>
      <Toggle
        on={hoverCard}
        set={setHoverCard}
        label="Hover card"
        detail="Point at a building on the map to see its owner, occupancy, rent, value and asking price. Off, the map stays clean and a click still opens the building. Also on the map's bottom strip as Stats."
      />
      <Toggle
        on={fpsOn}
        set={setFpsOn}
        label="Frame counter"
        detail="A frames-per-second readout in the top bar. It is an instrument for looking at the renderer, not part of the game, and it is off unless you want it."
      />
      {UNREAL_HOST ? <UnrealGraphics /> : (<>
      <div className="page-section" style={{ marginTop: 10 }}>Graphics</div>
      <div className="btn-row">
        {([
          ["high", "High", "The full picture: sharp shadows, native pixel density, every prop and passer-by."],
          ["medium", "Medium", "Softer shadows, capped pixel density, fewer people and cars; small props drop out sooner as you zoom out."],
          ["low", "Low", "For laptops without a graphics card: no shadows, standard pixel density, a light crowd, small props only up close, no falling rain or snow."],
        ] as const).map(([q, label, tip]) => (
          <button key={q} type="button" className={"btn" + (graphics === q ? " btn-on" : "")} title={tip} onClick={() => setGraphics(q)}>{label}</button>
        ))}
      </div>
      <div className="hint">
        Looks only — the city, its numbers and your save are the same at every setting. If the map stutters, step down one.
      </div>
      </>)}
      <div className="hint">
        Pop-up cards is a preference of this browser and applies to every campaign. The broker and auction
        switches are decisions of this firm and travel with the save.
      </div>
      <div className="page-section" style={{ marginTop: 18 }}>Keyboard</div>
      <div className="grid">
        <Row k="Space / G" v="Play / pause — the clock runs a month a second and pauses when something needs you" />
        <Row k="Y" v="Advance up to one year, stopping when a decision arrives" />
        <Row k="N" v="Skip to the next decision, up to three years" />
        <Row k="M" v="Map only — hide firm pages, keep the skyline" />
        <Row k="P" v="Photo frame — hide all chrome for a clean skyline still" />
        <Row k="Escape" v="Put off the card in front of you (its Not now), else close the open page, else deselect" />
        <Row k="1 – 9" v="Open a desk: Portfolio, Market, Deals, Capital, City, Firm" />
        <Row k="⌘K / Ctrl K" v="Search every building, desk and firm" />
        <Row k="?" v="Every key on one card, from anywhere" />
      </div>
      <div className="hint">
        Time shortcuts are disabled while a blocking decision card is on screen; answer or dismiss the card first.
      </div>
    </div>
  );
}

export function SavesPage() {
  const devGrant = useStore((s) => s.devGrant);
  const game = useStore((s) => s.game);
  return (
    <div>
      <SaveSlots />
      <div className="page-section" style={{ marginTop: 22 }}>
        <div className="page-section-head">Testing</div>
        <div className="hint">
          Not part of the game. It books nothing and proves nothing — it just puts money on the
          table so you can try things without playing your way to them first.
        </div>
        <div className="btn-row" style={{ marginTop: 8 }}>
          {/* a test lever, not the page's primary action */}
          <button className="btn btn-sm" onClick={devGrant}>+ $100M testing capital</button>
          {game && <span className="hint" style={{ margin: "auto 0" }}>cash today: {usd(game.cash)}</span>}
        </div>
      </div>
    </div>
  );
}

// Named saves are deliberate snapshots; the live campaign is also protected by
// a debounced idle autosave that stays out of this list.
export function SaveSlots() {
  const slots = useStore((s) => s.slots);
  const thisRun = useStore((s) => s.game);
  const { saveTo, loadFrom, dropSave, refreshSlots } = useStore.getState();
  const [name, setName] = useState("");
  // The named save with a deletion pending — window.confirm here had the same
  // browser-chrome problem as demolition, and the same silent-false failure.
  const [killSlot, setKillSlot] = useState<string | null>(null);
  useEffect(() => { void refreshSlots(); }, [refreshSlots]);
  return (
    <div className="page-section">
      <div className="page-section-head">Named saves</div>
      {thisRun?.setup && (
        <div className="hint" style={{ marginBottom: 6 }}>
          This campaign: {thisRun.setup.sandbox ? <span className="badge badge-warn">SANDBOX</span> : null}{" "}
          {describeSetup(thisRun.setup) || "the standard world"} · seed <span className="mono">{thisRun.citySeed ?? thisRun.seed}</span>
        </div>
      )}
      <div className="hint">
        Your live campaign autosaves after changes and Continue opens the newest state. Name a slot when you want
        a permanent snapshot you can return to without overwriting it.
      </div>
      <div className="btn-row" style={{ marginTop: 8 }}>
        <input
          className="ask-input mono"
          style={{ width: 200 }}
          placeholder="name this save"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) { void saveTo(name.trim()); setName(""); } }}
          aria-label="Name this save"
        />
        <button className="btn btn-buy" disabled={!name.trim()} onClick={() => { void saveTo(name.trim()); setName(""); }}>
          Save
        </button>
      </div>
      <div style={{ marginTop: 10 }}>
        {slots.map((m) => (
          <div key={m.slot} className="slot-row">
            <div>
              <div className="slot-name">{m.slot}</div>
              <div className="slot-meta mono">{monthLabel(m.month)} · {usd(m.cash)} cash · saved {new Date(m.savedAt).toLocaleDateString()}</div>
              {m.setup && <div className="slot-meta">{m.sandbox ? <span className="badge badge-warn">SANDBOX</span> : null} {m.setup}</div>}
            </div>
            <div className="btn-row" style={{ margin: 0 }}>
              <button className="btn btn-buy" onClick={() => void loadFrom(m.slot)}>Load</button>
              <button className="btn btn-sell" onClick={() => setKillSlot(m.slot)}>Delete</button>
            </div>
          </div>
        ))}
        {!slots.length && <div className="hint">No named saves yet.</div>}
        {(() => {
          const doomed = killSlot === null ? undefined : slots.find((s2) => s2.slot === killSlot);
          if (!doomed) return null;
          return (
            <div className="modal-backdrop">
              <div className="modal">
                <div className="modal-kicker">Delete a saved game</div>
                <div className="modal-title">{doomed.slot}</div>
                <div className="modal-sub">
                  {monthLabel(doomed.month)} · {usd(doomed.cash)} cash · saved {new Date(doomed.savedAt).toLocaleDateString()}.
                  Gone is gone — there is no bin to fish it back out of.
                </div>
                <div className="modal-actions">
                  <button className="btn btn-sell" onClick={() => { setKillSlot(null); void dropSave(doomed.slot); }}>Delete it</button>
                  <button className="btn" data-esc onClick={() => setKillSlot(null)}>Keep it</button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}


/**
 * GRAPHICS IN THE 3D GAME: four presets, then every option they set, so a
 * player tunes the picture to their machine. Each option says what it does and
 * what it costs (measured at 1080p, RTX 2080; see state/graphics.ts); the game
 * applies a change at once.
 */
function UnrealGraphics() {
  const gfx = useStore((s) => s.gfx);
  const setGfx = useStore((s) => s.setGfx);
  const [open, setOpen] = useState(false);
  const preset = presetOf(gfx);
  const set = (p: Partial<GfxOptions>) => setGfx({ ...gfx, ...p });
  const chip = (on: boolean) => "btn btn-sm" + (on ? " btn-on" : "");
  const LEVELS = ["Low", "Medium", "High", "Epic", "Cinematic"];
  const Opt = ({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) => (
    <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 8, alignItems: "start", margin: "6px 0" }}>
      <div><div>{label}</div><div className="hint" style={{ margin: 0 }}>{hint}</div></div>
      <div className="btn-row" style={{ flexWrap: "wrap" }}>{children}</div>
    </div>
  );
  type LevelKey = "giq" | "shadow" | "view" | "textures" | "effects" | "post";
  const Level = ({ k, max = 4, min = 0 }: { k: LevelKey; max?: number; min?: number }) => (
    <>{LEVELS.slice(min, max + 1).map((n, i) => (
      <button key={n} type="button" className={chip(gfx[k] === i + min)} onClick={() => set({ [k]: i + min } as Partial<GfxOptions>)}>{n}</button>
    ))}</>
  );
  const PRESETS: [GfxPreset, string, string][] = [
    ["low", "Low", "For laptops and older cards: half resolution upscaled, simple shadows, clouds without their shadows, a light crowd."],
    ["medium", "Medium", "Two-thirds resolution upscaled with DLSS or TSR, full lighting at a lower quality. The best balance on most cards."],
    ["high", "High", "Native resolution, full lighting, shadows and clouds. For strong cards (RTX 3070 and up at 1080p)."],
    ["ultra", "Ultra", "Cinematic lighting, shadows and draw distance. For the strongest cards, and screenshots."],
  ];
  return (
    <>
      <div className="page-section" style={{ marginTop: 10 }}>Graphics</div>
      <div className="btn-row" style={{ flexWrap: "wrap" }}>
        {PRESETS.map(([q, label, tip]) => (
          <button key={q} type="button" className={"btn" + (preset === q ? " btn-on" : "")} title={tip} onClick={() => setGfx({ ...GFX_PRESETS[q] })}>{label}</button>
        ))}
        {!preset && <span className="hint" style={{ alignSelf: "center" }}>Custom</span>}
      </div>
      <div className="hint">
        Measured on an RTX 2080 at 1080p: Low about 68 fps, Medium 63, High 36, Ultra 17. A newer card runs each about twice as fast.
        Looks only: the city, its numbers and your save are the same at every setting.
      </div>
      <button type="button" className="btn btn-sm" onClick={() => setOpen(!open)} style={{ margin: "6px 0" }}>{open ? "Hide advanced" : "Advanced settings"}</button>
      {open && (
        <div>
          <Opt label="Render resolution" hint="The biggest lever. Rendered smaller and upscaled to your screen.">
            {[50, 58, 67, 77, 100].map((r) => (
              <button key={r} type="button" className={chip(gfx.res === r)} onClick={() => set({ res: r })}>{r}%</button>
            ))}
          </Opt>
          <Opt label="Upscaler" hint="DLSS on NVIDIA RTX cards (sharper), TSR everywhere else.">
            <button type="button" className={chip(gfx.up === "auto")} onClick={() => set({ up: "auto" })}>DLSS if available</button>
            <button type="button" className={chip(gfx.up === "tsr")} onClick={() => set({ up: "tsr" })}>TSR</button>
          </Opt>
          <Opt label="Lighting" hint="Light bouncing between buildings (Lumen) and its quality. Off is flat but fast.">
            <button type="button" className={chip(gfx.gi === "off")} onClick={() => set({ gi: "off" })}>Off</button>
            {gfx.gi !== "off"
              ? <Level k="giq" min={1} />
              : <button type="button" className="btn btn-sm" onClick={() => set({ gi: "lumen" })}>On</button>}
          </Opt>
          <Opt label="Reflections" hint="Glass and wet streets reflecting the city.">
            {(["off", "ssr", "lumen"] as const).map((r) => (
              <button key={r} type="button" className={chip(gfx.reflections === r)} onClick={() => set({ reflections: r })}>
                {r === "off" ? "Off" : r === "ssr" ? "Screen space" : "Full"}
              </button>
            ))}
          </Opt>
          <Opt label="Shadows" hint="Sharpness and reach of building shadows."><Level k="shadow" /></Opt>
          <Opt label="Clouds" hint="Full clouds also cast moving shadows on the city (about 3 ms).">
            <button type="button" className={chip(gfx.clouds === 1)} onClick={() => set({ clouds: 1 })}>Simple</button>
            <button type="button" className={chip(gfx.clouds === 2)} onClick={() => set({ clouds: 2 })}>Full, with shadows</button>
          </Opt>
          <Opt label="View distance" hint="How far small things (props, trees) are drawn."><Level k="view" /></Opt>
          <Opt label="Textures" hint="Texture detail; lower it on a card with little memory."><Level k="textures" max={3} /></Opt>
          <Opt label="Effects" hint="Rain, snow, haze and material detail."><Level k="effects" max={3} /></Opt>
          <Opt label="Post-processing" hint="Exposure, bloom and colour grade quality."><Level k="post" max={3} /></Opt>
          <Opt label="City life" hint="Walkers and moving traffic. Light draws them only near the camera.">
            {(["Off", "Light", "Full"] as const).map((n, i) => (
              <button key={n} type="button" className={chip(gfx.life === i)} onClick={() => set({ life: i })}>{n}</button>
            ))}
          </Opt>
          <Opt label="Frame cap" hint="Cap the frame rate to save power and heat.">
            {[0, 30, 60, 120, 144].map((f) => (
              <button key={f} type="button" className={chip(gfx.fps === f)} onClick={() => set({ fps: f })}>{f ? String(f) : "None"}</button>
            ))}
          </Opt>
          <Opt label="V-Sync" hint="No tearing, at a little latency.">
            <button type="button" className={chip(!gfx.vsync)} onClick={() => set({ vsync: false })}>Off</button>
            <button type="button" className={chip(gfx.vsync)} onClick={() => set({ vsync: true })}>On</button>
          </Opt>
          <Opt label="Motion blur" hint="Blur on fast camera moves.">
            <button type="button" className={chip(!gfx.blur)} onClick={() => set({ blur: false })}>Off</button>
            <button type="button" className={chip(gfx.blur)} onClick={() => set({ blur: true })}>On</button>
          </Opt>
        </div>
      )}
    </>
  );
}
